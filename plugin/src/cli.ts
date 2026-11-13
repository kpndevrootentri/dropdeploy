#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cwd as processCwd } from 'node:process';
import { readCredentials, clearCredentials, login, PRODUCTION_URL, type Credentials } from './auth.js';
import { EntrifyApi, type Project } from './api.js';
import { getGitInfo, validateLocal } from './detector.js';
import {
  CliError,
  EXIT,
  buildDeployUrl,
  cliName,
  normaliseRepoUrl,
  parseArgs,
  parseDotenv,
  previousDeployed,
  projectNameFromRepo,
} from './util.js';

/** `entrify` or `dropdeploy`, whichever was typed. */
const BIN = cliName();

// ── ANSI colours (no external dep) ──────────────────────────────────────────
const c = {
  green:  (s: string) => `\x1b[32m${s}\x1b[0m`,
  red:    (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan:   (s: string) => `\x1b[36m${s}\x1b[0m`,
  bold:   (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim:    (s: string) => `\x1b[2m${s}\x1b[0m`,
};

// ── Output: human text, or exactly one JSON object with --json ──────────────
let jsonMode = false;

/** Human-readable output. Silent with --json, so stdout carries only the JSON result. */
function say(...args: unknown[]): void {
  if (!jsonMode) console.log(...args);
}

function sayInline(text: string): void {
  if (!jsonMode) process.stdout.write(text);
}

/** A command's result. With --json it is printed as `{ "ok": true, ... }`; humans have already been told. */
function emit(result: Record<string, unknown>): void {
  if (jsonMode) process.stdout.write(JSON.stringify({ ok: true, ...result }) + '\n');
}

function colourStatus(status: string | undefined): string {
  if (!status) return c.dim('no deployments');
  if (status === 'DEPLOYED') return c.green(status);
  return status === 'FAILED' ? c.red(status) : c.yellow(status);
}

const publicProject = (p: Project) => ({ id: p.id, slug: p.slug, name: p.name });

// ── Interactive prompt ───────────────────────────────────────────────────────
async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function promptHidden(question: string): Promise<string> {
  process.stdout.write(question);

  if (!process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin });
    return new Promise((resolve) => {
      rl.once('line', (line) => { rl.close(); resolve(line.trim()); });
    });
  }

  return new Promise((resolve, reject) => {
    let password = '';
    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener('data', onData);
    };
    const onData = (char: string) => {
      try {
        if (char === '\r' || char === '\n') {
          cleanup();
          process.stdout.write('\n');
          resolve(password);
        } else if (char === '\u0003') {
          cleanup();
          process.stdout.write('\n');
          process.exit(0);
        } else if (char === '\u007f' || char === '\u0008') {
          password = password.slice(0, -1);
        } else {
          password += char;
        }
      } catch (e) {
        cleanup();
        reject(e);
      }
    };
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', onData);
  });
}

// ── Progress bar ─────────────────────────────────────────────────────────────
type BuildStep = 'CLONING' | 'SCANNING' | 'BUILDING_IMAGE' | 'STARTING_CONTAINER';

const STEP_PERCENT: Record<BuildStep, number> = {
  CLONING: 20,
  SCANNING: 40,
  BUILDING_IMAGE: 70,
  STARTING_CONTAINER: 90,
};

const STEP_LABEL: Record<BuildStep, string> = {
  CLONING: 'Cloning repository',
  SCANNING: 'Scanning packages',
  BUILDING_IMAGE: 'Building Docker image',
  STARTING_CONTAINER: 'Starting container',
};

function detectBuildStep(line: string): BuildStep | null {
  if (line.includes('▶ Cloning'))       return 'CLONING';
  if (line.includes('▶ Scanning'))      return 'SCANNING';
  if (line.includes('▶ Building image')) return 'BUILDING_IMAGE';
  if (line.includes('▶ Starting'))      return 'STARTING_CONTAINER';
  return null;
}

function renderBar(percent: number, label: string): string {
  const width = 20;
  const filled = Math.round((percent / 100) * width);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  return `  [${c.cyan(bar)}] ${String(percent).padStart(3)}%  ${c.dim(label)}`;
}

const isTTY = process.stdout.isTTY ?? false;

function printProgress(percent: number, label: string): void {
  if (!isTTY || jsonMode) return;
  process.stdout.write('\r' + renderBar(percent, label) + '  ');
}

function clearProgress(): void {
  if (!isTTY || jsonMode) return;
  process.stdout.write('\r' + ' '.repeat(72) + '\r');
}

// ── Error diagnosis from build log tail ─────────────────────────────────────
const ERROR_PATTERNS: Array<{ re: RegExp; cause: string; fix: string }> = [
  {
    re: /no space left on device/i,
    cause: 'The Entrify server ran out of disk space',
    fix: 'Not a problem in your code: ask the Entrify admin to free space, then redeploy',
  },
  {
    re: /did not start listening/i,
    cause: 'The app never accepted connections on its port',
    fix: 'Listen on 0.0.0.0 (not 127.0.0.1 or localhost) and on the PORT environment variable',
  },
  {
    re: /exited during startup/i,
    cause: 'The app crashed while starting',
    fix: `Read the error above; if it asks for a setting, add it with \`${BIN} env set KEY=VALUE\` and redeploy`,
  },
  {
    re: /Cannot find module|Module not found/i,
    cause: 'Missing dependency',
    fix: 'Run `npm install` locally and push your changes',
  },
  {
    re: /ENOENT.*package\.json/i,
    cause: 'package.json not found',
    fix: 'Ensure package.json is committed to the repo',
  },
  {
    re: /Authentication failed|could not read Username/i,
    cause: 'Git authentication failed',
    fix: 'Reconnect your Git provider in Entrify → Settings',
  },
  {
    re: /Blocked package/i,
    cause: 'Blocked package detected',
    fix: 'Remove the flagged package from package.json and push',
  },
  {
    re: /npm ERR!/i,
    cause: 'npm build error',
    fix: 'Run `npm run build` locally to reproduce and debug',
  },
  {
    re: /error TS\d+/i,
    cause: 'TypeScript compile error',
    fix: 'Run `tsc --noEmit` locally to see type errors',
  },
  {
    re: /exit code: 1|exited with code 1/i,
    cause: 'Build script exited with an error',
    fix: 'Run the build command locally to debug the output',
  },
];

function diagnose(log: string): { cause: string; fix: string } | null {
  const tail = log.split('\n').slice(-40).join('\n');
  for (const { re, cause, fix } of ERROR_PATTERNS) {
    if (re.test(tail)) return { cause, fix };
  }
  return null;
}

// ── Auth ─────────────────────────────────────────────────────────────────────
async function requireCreds(): Promise<Credentials> {
  const creds = await readCredentials();
  if (!creds) throw new CliError(`Not logged in. Run: ${BIN} auth login`, 'NOT_LOGGED_IN', EXIT.AUTH);
  return creds;
}

// ── Project selection ────────────────────────────────────────────────────────
interface ProjectQuery {
  remoteUrl: string | null;
  branch: string;
  projectId: string | null;
  /** Set by `deploy --create`: make a project from the remote when none matches. */
  create?: { detectedType: string | null };
}

async function createProjectFromRemote(
  api: EntrifyApi,
  { remoteUrl, branch, detectedType }: { remoteUrl: string; branch: string; detectedType: string | null },
): Promise<Project> {
  const repo = normaliseRepoUrl(remoteUrl);
  const host = repo.split('/')[0];
  const source = host === 'github.com' ? 'GITHUB' : host.includes('gitlab') ? 'GITLAB' : null;
  if (!source) {
    throw new CliError(`Only GitHub and GitLab repositories can be deployed (this remote is on ${host}).`, 'UNSUPPORTED_REMOTE', EXIT.NEEDS_INPUT);
  }
  return api.createProject({
    name: projectNameFromRepo(remoteUrl),
    source,
    githubUrl: `https://${repo}`,
    type: detectedType ?? undefined,
    branch: branch === 'HEAD' ? undefined : branch,
  });
}

async function pickProject(api: EntrifyApi, query: ProjectQuery): Promise<{ project: Project; created: boolean }> {
  const projects = await api.listProjects();

  if (query.projectId) {
    const p = projects.find((p) => p.id === query.projectId || p.slug === query.projectId);
    if (!p) {
      throw new CliError(`Project "${query.projectId}" not found. List them with: ${BIN} projects`, 'PROJECT_NOT_FOUND', EXIT.NEEDS_INPUT);
    }
    return { project: p, created: false };
  }

  // Auto-match by git remote URL (HTTPS or SSH); with several projects on one repo, prefer this branch's
  if (query.remoteUrl) {
    const needle = normaliseRepoUrl(query.remoteUrl);
    const matches = projects.filter(
      (p) => p.githubUrl && normaliseRepoUrl(p.githubUrl) === needle,
    );
    if (matches.length > 0) {
      return { project: matches.find((p) => p.branch === query.branch) ?? matches[0], created: false };
    }
    if (query.create) {
      const project = await createProjectFromRemote(api, { remoteUrl: query.remoteUrl, branch: query.branch, ...query.create });
      return { project, created: true };
    }
  }

  const hint = `Pass --project-id <id|slug> (list them with: ${BIN} projects), or deploy with --create to make a new project from this repository.`;
  if (projects.length === 0) {
    throw new CliError(`No projects found on Entrify. ${hint}`, 'NO_PROJECTS', EXIT.NEEDS_INPUT);
  }

  // Without a terminal (CI, coding agents) or with --json, nobody can answer the prompt below.
  if (!process.stdin.isTTY || jsonMode) {
    throw new CliError(`No project matches this repository. ${hint}`, 'NO_PROJECT_MATCH', EXIT.NEEDS_INPUT);
  }

  say(`\n${c.bold('Select a project:')}`);
  projects.forEach((p, i) => {
    say(`  ${c.cyan(String(i + 1))}) ${p.name}  ${c.dim(`(${p.slug})`)}  ${colourStatus(p.deployments?.[0]?.status)}`);
  });

  const answer = await prompt(`\nEnter number [1-${projects.length}]: `);
  const idx = parseInt(answer, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= projects.length) {
    throw new CliError('Invalid selection', 'INVALID_SELECTION', EXIT.NEEDS_INPUT);
  }
  return { project: projects[idx], created: false };
}

/** The project for the repository in --dir (or the current directory), or --project-id. Never creates one. */
async function resolveProject(api: EntrifyApi, flags: Record<string, string>): Promise<Project> {
  const git = await getGitInfo(flags['dir'] ?? processCwd());
  const { project } = await pickProject(api, { remoteUrl: git.remoteUrl, branch: git.branch, projectId: flags['project-id'] ?? null });
  return project;
}

// ── Following a deployment to the end ────────────────────────────────────────
interface Outcome {
  status: 'DEPLOYED' | 'FAILED' | 'CANCELLED' | 'TIMEOUT';
  subdomain: string | null;
  log: string;
  step: BuildStep | null;
}

/** Streams the build log (with a progress bar for humans), then waits for the final status. */
async function followDeployment(api: EntrifyApi, projectId: string, deploymentId: string): Promise<Outcome> {
  const logLines: string[] = [];
  let currentStep: BuildStep | null = null;
  let currentPercent = 5;

  printProgress(currentPercent, 'Waiting in queue…');

  try {
    for await (const evt of api.streamLogs(projectId, deploymentId)) {
      if (evt.type === 'line') {
        logLines.push(evt.text);
        const step = detectBuildStep(evt.text);
        if (step) {
          currentStep = step;
          currentPercent = STEP_PERCENT[step];
          clearProgress();
          say(`\n  ${c.cyan('›')}  ${c.bold(STEP_LABEL[step])}`);
          printProgress(currentPercent, STEP_LABEL[step] + '…');
        } else {
          clearProgress();
          say(`  ${c.dim(evt.text)}`);
          printProgress(currentPercent, currentStep ? STEP_LABEL[currentStep] + '…' : 'Building…');
        }
      } else if (evt.type === 'existing') {
        for (const l of evt.log.split('\n')) {
          const step = detectBuildStep(l);
          if (step) {
            currentStep = step;
            currentPercent = STEP_PERCENT[step];
          }
        }
        logLines.push(evt.log);
      } else if (evt.type === 'done') {
        break;
      }
    }
  } catch {
    clearProgress();
    say(`  ${c.yellow('⚠')}  Log stream disconnected — polling for result…`);
  }

  clearProgress();

  // SSE ends slightly before DB is updated — poll with exponential backoff
  let finalLog: string | null = null;
  let subdomain: string | null = null;
  let consecutiveErrors = 0;
  for (let attempt = 0; attempt < 20; attempt++) {
    const delay = Math.min(1000 * 2 ** attempt, 10_000);
    await new Promise((r) => setTimeout(r, delay));
    try {
      const s = await api.getDeploymentStatus(projectId, deploymentId);
      consecutiveErrors = 0;
      finalLog = s.buildLog;
      subdomain = s.subdomain;
      if (s.status === 'DEPLOYED' || s.status === 'FAILED' || s.status === 'CANCELLED') {
        return { status: s.status, subdomain, log: finalLog ?? logLines.join(''), step: currentStep };
      }
    } catch {
      if (++consecutiveErrors >= 5) break;
    }
  }
  return { status: 'TIMEOUT', subdomain, log: finalLog ?? logLines.join(''), step: currentStep };
}

/** Prints the result of a deploy or rollback; a deployment that did not go live is thrown as a CliError. */
function reportDeployment(
  { creds, project, deploymentId, outcome, details }:
  { creds: Credentials; project: Project; deploymentId: string; outcome: Outcome; details: Record<string, unknown> },
): void {
  const base = { project: publicProject(project), deploymentId, status: outcome.status, ...details };
  say();

  if (outcome.status === 'DEPLOYED') {
    const url = outcome.subdomain ? buildDeployUrl(creds.apiUrl, outcome.subdomain) : null;
    say(c.bold(c.green('✓ Deployed successfully')));
    if (url) say(`\n  ${c.bold('Live URL')}  →  ${c.cyan(url)}`);
    say();
    emit({ ...base, url });
    return;
  }

  if (outcome.status === 'FAILED') {
    say(c.bold(c.red(`✗ Deployment failed${outcome.step ? ` at: ${c.bold(outcome.step)}` : ''}`)));
    say();
    const lines = outcome.log.split('\n').filter(Boolean);
    const diagnosis = outcome.log ? diagnose(outcome.log) : null;
    if (lines.length > 0) {
      say(`  ${c.dim('Last 20 lines of build log:')}`);
      say('  ' + '─'.repeat(52));
      for (const l of lines.slice(-20)) say(`  ${c.dim(l)}`);
      say('  ' + '─'.repeat(52));
      say();
      if (diagnosis) {
        say(`  ${c.yellow('Probable cause:')}  ${diagnosis.cause}`);
        say(`  ${c.cyan('Suggested fix:')}   ${diagnosis.fix}`);
        say();
      }
    }
    throw new CliError(`Deployment failed${outcome.step ? ` at ${outcome.step}` : ''}`, 'DEPLOY_FAILED', EXIT.FAILED, {
      ...base,
      step: outcome.step,
      cause: diagnosis?.cause ?? null,
      fix: diagnosis?.fix ?? null,
      logTail: lines.slice(-40),
    });
  }

  if (outcome.status === 'CANCELLED') {
    throw new CliError('The deployment was cancelled.', 'DEPLOY_CANCELLED', EXIT.FAILED, base);
  }

  const dashboard = `${creds.apiUrl}/projects/${project.id}`;
  throw new CliError(`Timed out waiting for the deployment to finish. Check: ${BIN} status, or ${dashboard}`, 'DEPLOY_TIMEOUT', EXIT.FAILED, { ...base, dashboard });
}

// ── Commands ─────────────────────────────────────────────────────────────────

async function cmdAuthLogin(flags: Record<string, string>): Promise<void> {
  const apiUrl = flags['api-url'] ?? PRODUCTION_URL;
  console.log(`Connecting to ${c.cyan(apiUrl)}`);
  const email = flags['email'] ?? (await prompt('Email: '));
  const password = await promptHidden('Password: ');

  process.stdout.write('Logging in… ');
  const creds = await login(apiUrl, email, password);
  console.log(c.green('✓'));
  console.log(`Logged in as ${c.bold(creds.email)}`);
}

async function cmdAuthStatus(): Promise<void> {
  const creds = await requireCreds();
  say(`${c.green('✓')} Logged in as ${c.bold(creds.email)}`);
  say(`  API: ${c.dim(creds.apiUrl)}`);
  emit({ email: creds.email, apiUrl: creds.apiUrl });
}

async function cmdAuthLogout(): Promise<void> {
  await clearCredentials();
  say(`${c.green('✓')} Logged out`);
  emit({});
}

async function cmdProjects(): Promise<void> {
  const creds = await requireCreds();
  const projects = await new EntrifyApi(creds).listProjects();
  const rows = projects.map((p) => {
    const latest = p.deployments?.[0];
    return { ...publicProject(p), type: p.type, status: latest?.status ?? null, url: latest?.subdomain ? buildDeployUrl(creds.apiUrl, latest.subdomain) : null };
  });

  if (rows.length === 0) say('No projects found.');
  else {
    say(`\n${c.bold('Your projects:')}`);
    for (const r of rows) {
      say(`  ${c.cyan(r.slug)}  ${r.name}  ${colourStatus(r.status ?? undefined)}`);
      if (r.url) say(`    ${c.dim('→ ' + r.url)}`);
    }
    say();
  }
  emit({ projects: rows });
}

async function cmdDeploy(flags: Record<string, string>): Promise<void> {
  const dir = flags['dir'] ?? processCwd();
  const creds = await requireCreds();
  const api = new EntrifyApi(creds);
  const warnings: string[] = [];
  const warn = (w: string) => {
    warnings.push(w);
    say(`  ${c.yellow('⚠')}  ${w}`);
  };

  say(`\n${c.bold('▶ Entrify')}\n`);

  sayInline('  Checking repository… ');
  const gitInfo = await getGitInfo(dir);
  say(c.green('✓'));
  if (gitInfo.isDirty) warn('Working tree has uncommitted changes. Entrify deploys what is pushed, not local files.');

  sayInline('  Validating project… ');
  const validation = await validateLocal(dir, gitInfo);
  if (!validation.ok) {
    say(c.red('✗'));
    for (const e of validation.errors) say(`  ${c.red('✗')}  ${e}`);
    throw new CliError(validation.errors.join(' '), 'INVALID_PROJECT', EXIT.NEEDS_INPUT, { errors: validation.errors });
  }
  say(c.green('✓'));
  validation.warnings.forEach(warn);

  let detectedType: string | null = null;
  if (gitInfo.remoteUrl) {
    sayInline('  Detecting framework… ');
    try {
      const detected = await api.detectType(gitInfo.remoteUrl, gitInfo.branch);
      detectedType = detected.type;
      say(`${c.green('✓')}  ${c.bold(detected.type)} ${c.dim(`(${detected.hint})`)}`);
    } catch {
      say(c.dim('skipped'));
    }
  }

  sayInline('  Resolving project… ');
  const { project, created } = await pickProject(api, {
    remoteUrl: gitInfo.remoteUrl,
    branch: gitInfo.branch,
    projectId: flags['project-id'] ?? null,
    create: flags['create'] === 'true' ? { detectedType } : undefined,
  });
  say(`${c.green('✓')}  ${c.bold(project.name)} ${c.dim(`(${project.slug})`)}${created ? c.dim('  (new project)') : ''}`);
  if (project.source === 'UPLOAD') {
    throw new CliError(
      `"${project.slug}" was created by uploading files, so there is no repository to build. Upload a new version from the dashboard: ${creds.apiUrl}/projects/${project.id}`,
      'UPLOAD_PROJECT',
      EXIT.NEEDS_INPUT,
    );
  }
  // The server builds the project's branch, not whatever is checked out here.
  if (project.branch && gitInfo.branch !== 'HEAD' && gitInfo.branch !== project.branch) {
    warn(`This project deploys branch ${project.branch}; you are on ${gitInfo.branch}.`);
  }

  sayInline('  Triggering deployment… ');
  const { deploymentId, queued } = await api.triggerDeploy(project.id);
  say(c.green('✓') + (queued ? c.dim('  (queued behind active build)') : ''));
  say();

  const outcome = await followDeployment(api, project.id, deploymentId);
  reportDeployment({ creds, project, deploymentId, outcome, details: { created, warnings } });
}

async function cmdStatus(flags: Record<string, string>): Promise<void> {
  const creds = await requireCreds();
  const api = new EntrifyApi(creds);
  const project = await resolveProject(api, flags);
  const deployments = await api.listDeployments(project.id, 10);
  const latest = deployments[0] ?? null;
  const live = deployments.find((d) => d.status === 'DEPLOYED' && d.subdomain);
  const url = live?.subdomain ? buildDeployUrl(creds.apiUrl, live.subdomain) : null;

  say(`\n${c.bold(project.name)} ${c.dim(`(${project.slug})`)}`);
  say(`  Latest:  ${colourStatus(latest?.status)}${latest ? c.dim(`  ${latest.createdAt}  ${latest.id}`) : ''}`);
  say(`  Live:    ${url ? c.cyan(url) : c.dim('not live')}\n`);
  emit({
    project: publicProject(project),
    latest: latest && { id: latest.id, status: latest.status, createdAt: latest.createdAt, commitHash: latest.commitHash ?? null },
    url,
  });
}

async function cmdLogs(flags: Record<string, string>): Promise<void> {
  const creds = await requireCreds();
  const api = new EntrifyApi(creds);
  const project = await resolveProject(api, flags);
  const deploymentId = flags['deployment'] ?? (await api.listDeployments(project.id, 1))[0]?.id;
  if (!deploymentId) throw new CliError('This project has no deployments yet.', 'NO_DEPLOYMENTS', EXIT.NEEDS_INPUT);

  const lineLimit = flags['lines'] === 'all' ? Infinity : Number(flags['lines'] ?? 200);
  if (!(lineLimit > 0)) throw new CliError('--lines takes a positive number or "all".', 'USAGE', EXIT.NEEDS_INPUT);

  const tailOf = (text: string): string[] => {
    const lines = text.split('\n').filter(Boolean);
    return Number.isFinite(lineLimit) ? lines.slice(-lineLimit) : lines;
  };

  const current = await api.getDeploymentStatus(project.id, deploymentId);
  let status = current.status;
  let tail = tailOf(current.buildLog ?? '');
  for (const l of tail) say(l);
  if (flags['follow'] === 'true' && (status === 'QUEUED' || status === 'BUILDING')) {
    // Prints each new line as it arrives, after the lines above.
    const outcome = await followDeployment(api, project.id, deploymentId);
    status = outcome.status;
    tail = tailOf(outcome.log);
  }
  say(`\n${c.dim('Deployment')} ${deploymentId}  ${colourStatus(status)}`);
  emit({ project: publicProject(project), deploymentId, status, lines: tail });
}

/** `KEY=VALUE` to a pair. Errors name the key only, never the value. */
function parsePair(arg: string): [string, string] {
  const eq = arg.indexOf('=');
  if (eq < 1) throw new CliError(`Expected KEY=VALUE, got "${arg.split('=')[0]}"`, 'USAGE', EXIT.NEEDS_INPUT);
  return [arg.slice(0, eq), arg.slice(eq + 1)];
}

async function cmdEnv(sub: string | undefined, args: string[], flags: Record<string, string>): Promise<void> {
  const creds = await requireCreds();
  const api = new EntrifyApi(creds);
  const project = await resolveProject(api, flags);
  const existing = await api.listEnv(project.id);
  const applyHint = `Redeploy to apply: ${BIN} deploy`;

  if (sub === undefined || sub === 'list') {
    if (existing.length === 0) say('No environment variables set.');
    for (const v of existing) say(`  ${c.cyan(v.key)}  ${c.dim(v.environment)}`);
    emit({ project: publicProject(project), variables: existing.map((v) => ({ key: v.key, environment: v.environment })) });
    return;
  }

  if (sub === 'set' || sub === 'push') {
    let pairs: Array<[string, string]>;
    if (sub === 'push') {
      const file = resolve(flags['dir'] ?? processCwd(), args[0] ?? '.env');
      const text = await readFile(file, 'utf8').catch(() => {
        throw new CliError(`Cannot read ${file}`, 'FILE_NOT_FOUND', EXIT.NEEDS_INPUT);
      });
      pairs = parseDotenv(text);
    } else {
      pairs = args.map(parsePair);
    }
    if (pairs.length === 0) {
      throw new CliError(`Nothing to set. Use: ${BIN} env set KEY=VALUE … or ${BIN} env push [.env file]`, 'USAGE', EXIT.NEEDS_INPUT);
    }
    // A key given twice keeps its last value, as in a .env file.
    pairs = [...new Map(pairs)];

    const created: string[] = [];
    const updated: string[] = [];
    for (const [key, value] of pairs) {
      const found = existing.find((v) => v.key === key);
      if (found) {
        await api.updateEnv(project.id, found.id, value);
        updated.push(key);
      } else {
        await api.createEnv(project.id, key, value);
        created.push(key);
      }
    }
    say(`${c.green('✓')} Set ${pairs.length} variable(s) on ${c.bold(project.slug)}: ${[...created, ...updated].join(', ')}`);
    say(c.dim(applyHint));
    emit({ project: publicProject(project), created, updated, hint: applyHint });
    return;
  }

  if (sub === 'unset') {
    if (args.length === 0) throw new CliError(`Use: ${BIN} env unset KEY …`, 'USAGE', EXIT.NEEDS_INPUT);
    const removed: string[] = [];
    const missing: string[] = [];
    for (const key of args) {
      const found = existing.find((v) => v.key === key);
      if (!found) {
        missing.push(key);
        continue;
      }
      await api.deleteEnv(project.id, found.id);
      removed.push(key);
    }
    if (removed.length) say(`${c.green('✓')} Removed: ${removed.join(', ')}`);
    if (missing.length) say(`${c.yellow('⚠')}  Not set: ${missing.join(', ')}`);
    if (removed.length) say(c.dim(applyHint));
    emit({ project: publicProject(project), removed, missing, hint: applyHint });
    return;
  }

  throw new CliError('Unknown env subcommand. Use: list | set KEY=VALUE … | push [file] | unset KEY …', 'USAGE', EXIT.NEEDS_INPUT);
}

async function cmdRollback(flags: Record<string, string>): Promise<void> {
  const creds = await requireCreds();
  const api = new EntrifyApi(creds);
  const project = await resolveProject(api, flags);
  const targetId = flags['to'] ?? previousDeployed(await api.listDeployments(project.id, 50))?.id;
  if (!targetId) {
    throw new CliError('There is no earlier successful deployment to roll back to.', 'NO_ROLLBACK_TARGET', EXIT.NEEDS_INPUT);
  }

  sayInline(`  Rolling back ${c.bold(project.slug)} to ${c.dim(targetId)}… `);
  const { deploymentId } = await api.rollback(project.id, targetId);
  say(c.green('✓'));
  const outcome = await followDeployment(api, project.id, deploymentId);
  reportDeployment({ creds, project, deploymentId, outcome, details: { rolledBackTo: targetId } });
}

async function cmdCancel(flags: Record<string, string>): Promise<void> {
  const creds = await requireCreds();
  const api = new EntrifyApi(creds);
  const project = await resolveProject(api, flags);
  const active = flags['deployment']
    ?? (await api.listDeployments(project.id, 10)).find((d) => d.status === 'QUEUED' || d.status === 'BUILDING')?.id;
  if (!active) throw new CliError('No deployment is queued or building.', 'NOTHING_TO_CANCEL', EXIT.NEEDS_INPUT);

  await api.cancelDeployment(project.id, active);
  say(`${c.green('✓')} Cancelled ${active}`);
  emit({ project: publicProject(project), cancelled: active });
}

// ── Help ─────────────────────────────────────────────────────────────────────
function cmdHelp(): void {
  console.log(`
${c.bold(BIN)} — Deploy projects to Entrify from the terminal

${c.bold('USAGE')}
  ${BIN} <command> [flags]

${c.bold('COMMANDS')}
  ${c.cyan('deploy')}                       Deploy the current project  ${c.dim('(default)')}
    ${c.dim('--project-id <id|slug>')}      Skip project selection and deploy to a specific project
    ${c.dim('--create')}                    Create a project from this repository if none matches
    ${c.dim('--dir <path>')}                Use a different working directory
  ${c.cyan('status')}                       Latest deployment and live URL of the current project
  ${c.cyan('logs')}                         Build log of the latest deployment
    ${c.dim('--deployment <id>')}           A specific deployment instead of the latest
    ${c.dim('--lines <n|all>')}             How many lines from the end  ${c.dim('(default 200)')}
    ${c.dim('--follow')}                    Stream a deployment that is still building
  ${c.cyan('env list')}                     Environment variable names  ${c.dim('(values are never shown)')}
  ${c.cyan('env set KEY=VALUE …')}          Add or change variables
  ${c.cyan('env push [file]')}              Add or change every variable in a .env file  ${c.dim('(default .env)')}
  ${c.cyan('env unset KEY …')}              Remove variables
  ${c.cyan('rollback')}                     Go back to the previous successful deployment
    ${c.dim('--to <deployment-id>')}        A specific earlier deployment
  ${c.cyan('cancel')}                       Cancel the deployment that is queued or building
  ${c.cyan('projects')}                     List all your projects and their status

  ${c.cyan('auth login')}                   Log in to Entrify  ${c.dim('(default: entrify.site)')}
    ${c.dim('--api-url <url>')}             Override the default URL (e.g. for local dev)
    ${c.dim('--email <email>')}             Your email
    ${c.dim('(password is always prompted interactively)')}
  ${c.cyan('auth status')}                  Show current login status
  ${c.cyan('auth logout')}                  Clear saved credentials

  ${c.cyan('help')}                         Show this help message
  ${c.cyan('--version')}                    Print the CLI version

  The project is matched from the git remote of the current directory; pass
  ${c.dim('--project-id <id|slug>')} to any project command to choose one instead.

${c.bold('FOR SCRIPTS AND AI AGENTS')}
  ${c.dim('--json')}                        Print one JSON object: ${c.dim('{ "ok": true, ... }')} or ${c.dim('{ "ok": false, "error": { "code", "message" } }')}
  Exit codes: ${c.dim('0')} ok · ${c.dim('1')} failed · ${c.dim('2')} needs input (flag, project, file) · ${c.dim('3')} not logged in
  Commands never prompt without a terminal or with --json.

${c.bold('ENVIRONMENT')}  ${c.dim('(the DROPDEPLOY_* names still work)')}
  ${c.dim('ENTRIFY_TOKEN')}                 Bearer token  ${c.dim('(skips auth login in CI)')}
  ${c.dim('ENTRIFY_URL')}                   Entrify URL, e.g. https://entrify.site
  ${c.dim('ENTRIFY_EMAIL')}                 Email  ${c.dim('(optional, cosmetic)')}

${c.bold('EXAMPLES')}
  ${c.dim('$')} ${BIN} auth login
  ${c.dim('$')} ${BIN} deploy
  ${c.dim('$')} ${BIN} deploy --create --json
  ${c.dim('$')} ${BIN} logs --follow
  ${c.dim('$')} ${BIN} env push .env.production
  ${c.dim('$')} ${BIN} rollback
`);
}

// ── Entry point ───────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const [cmd, sub, ...rest] = command;
  jsonMode = flags['json'] === 'true';

  if (flags['help'] === 'true') return cmdHelp();

  if (cmd === 'version' || flags['version'] === 'true') {
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const pkgPath = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      'package.json',
    );
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as { version: string };
    console.log(pkg.version);
    return;
  }

  if (cmd === 'auth') {
    if (sub === 'login')  return cmdAuthLogin(flags);
    if (sub === 'status') return cmdAuthStatus();
    if (sub === 'logout') return cmdAuthLogout();
    throw new CliError('Unknown auth subcommand. Use: login | status | logout', 'USAGE', EXIT.NEEDS_INPUT);
  }

  if (cmd === 'projects') return cmdProjects();
  if (cmd === 'deploy' || cmd === undefined) return cmdDeploy(flags);
  if (cmd === 'status') return cmdStatus(flags);
  if (cmd === 'logs') return cmdLogs(flags);
  if (cmd === 'env') return cmdEnv(sub, rest, flags);
  if (cmd === 'rollback') return cmdRollback(flags);
  if (cmd === 'cancel') return cmdCancel(flags);
  if (cmd === 'help' || cmd === '--help' || cmd === '-h') return cmdHelp();

  throw new CliError(`Unknown command: ${cmd}. Run ${BIN} help for usage.`, 'USAGE', EXIT.NEEDS_INPUT);
}

main().catch((err: unknown) => {
  const e = err instanceof CliError ? err : new CliError(err instanceof Error ? err.message : String(err), 'ERROR');
  if (jsonMode) {
    process.stdout.write(JSON.stringify({ ok: false, error: { code: e.code, message: e.message }, ...e.details }) + '\n');
  } else {
    console.error(`\n${c.red('Error:')} ${e.message}`);
  }
  process.exit(e.exitCode);
});
