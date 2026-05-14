#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { cwd as processCwd } from 'node:process';
import { readCredentials, clearCredentials, login } from './auth.js';
import { DropDeployApi, type Project } from './api.js';
import { getGitInfo, validateLocal } from './detector.js';

// ── ANSI colours (no external dep) ──────────────────────────────────────────
const c = {
  green:  (s: string) => `\x1b[32m${s}\x1b[0m`,
  red:    (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan:   (s: string) => `\x1b[36m${s}\x1b[0m`,
  bold:   (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim:    (s: string) => `\x1b[2m${s}\x1b[0m`,
};

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
  if (!isTTY) return;
  process.stdout.write('\r' + renderBar(percent, label) + '  ');
}

function clearProgress(): void {
  if (!isTTY) return;
  process.stdout.write('\r' + ' '.repeat(72) + '\r');
}

// ── Build URL from credentials + subdomain ───────────────────────────────────
function buildDeployUrl(apiUrl: string, subdomain: string): string {
  try {
    const u = new URL(apiUrl);
    if (u.hostname === 'localhost' || u.hostname.startsWith('127.')) {
      return `${u.origin}/preview/${subdomain}`;
    }
    return `${u.protocol}//${subdomain}.${u.hostname}`;
  } catch {
    return `${apiUrl}/preview/${subdomain}`;
  }
}

// ── Error diagnosis from build log tail ─────────────────────────────────────
const ERROR_PATTERNS: Array<{ re: RegExp; cause: string; fix: string }> = [
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
    fix: 'Reconnect your Git provider in DropDeploy → Settings',
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

// ── Project selection ────────────────────────────────────────────────────────
function normaliseUrl(u: string): string {
  return u.replace(/\.git$/, '').replace(/^https?:\/\//, '').toLowerCase();
}

async function pickProject(
  api: DropDeployApi,
  remoteUrl: string | null,
  flagProjectId: string | null,
): Promise<Project> {
  const projects = await api.listProjects();

  if (flagProjectId) {
    const p = projects.find(
      (p) => p.id === flagProjectId || p.slug === flagProjectId,
    );
    if (!p) throw new Error(`Project "${flagProjectId}" not found`);
    return p;
  }

  // Auto-match by git remote URL
  if (remoteUrl) {
    const needle = normaliseUrl(remoteUrl);
    const matched = projects.find(
      (p) => p.githubUrl && normaliseUrl(p.githubUrl) === needle,
    );
    if (matched) return matched;
  }

  if (projects.length === 0) {
    throw new Error(
      'No projects found on DropDeploy. Create one from the dashboard first.',
    );
  }

  // Prompt user to pick
  console.log(`\n${c.bold('Select a project:')}`);
  projects.forEach((p, i) => {
    const latest = p.deployments?.[0];
    const status = latest
      ? latest.status === 'DEPLOYED'
        ? c.green(latest.status)
        : latest.status === 'FAILED'
          ? c.red(latest.status)
          : c.yellow(latest.status)
      : c.dim('no deployments');
    console.log(`  ${c.cyan(String(i + 1))}) ${p.name}  ${c.dim(`(${p.slug})`)}  ${status}`);
  });

  const answer = await prompt(`\nEnter number [1-${projects.length}]: `);
  const idx = parseInt(answer, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= projects.length) {
    throw new Error('Invalid selection');
  }
  return projects[idx];
}

// ── Commands ─────────────────────────────────────────────────────────────────

async function cmdAuthLogin(flags: Record<string, string>): Promise<void> {
  const PRODUCTION_URL = 'https://app.en3.wtf';
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
  const creds = await readCredentials();
  if (!creds) {
    console.log(`${c.yellow('Not logged in.')} Run: dropdeploy auth login`);
    process.exit(1);
  }
  console.log(`${c.green('✓')} Logged in as ${c.bold(creds.email)}`);
  console.log(`  API: ${c.dim(creds.apiUrl)}`);
}

async function cmdAuthLogout(): Promise<void> {
  await clearCredentials();
  console.log(`${c.green('✓')} Logged out`);
}

async function cmdProjects(): Promise<void> {
  const creds = await readCredentials();
  if (!creds) {
    console.error(c.red('Not logged in.') + ' Run: dropdeploy auth login');
    process.exit(1);
  }
  const api = new DropDeployApi(creds);
  const projects = await api.listProjects();

  if (projects.length === 0) {
    console.log('No projects found.');
    return;
  }

  console.log(`\n${c.bold('Your projects:')}`);
  for (const p of projects) {
    const latest = p.deployments?.[0];
    const statusStr = latest
      ? latest.status === 'DEPLOYED'
        ? c.green(latest.status)
        : latest.status === 'FAILED'
          ? c.red(latest.status)
          : c.yellow(latest.status)
      : c.dim('no deployments');
    console.log(`  ${c.cyan(p.slug)}  ${p.name}  ${statusStr}`);
    if (latest?.subdomain) {
      console.log(`    ${c.dim('→ ' + buildDeployUrl(creds.apiUrl, latest.subdomain))}`);
    }
  }
  console.log();
}

async function cmdDeploy(flags: Record<string, string>): Promise<void> {
  const dir = flags['dir'] ?? processCwd();

  // ── 1. Auth check ──────────────────────────────────────────────────────────
  const creds = await readCredentials();
  if (!creds) {
    console.error(
      c.red('Not logged in.') + ' Run: dropdeploy auth login',
    );
    process.exit(1);
  }
  const api = new DropDeployApi(creds);

  console.log(`\n${c.bold('▶ DropDeploy')}\n`);

  // ── 2. Git info ───────────────────────────────────────────────────────────
  process.stdout.write('  Checking repository… ');
  const gitInfo = await getGitInfo(dir);
  console.log(c.green('✓'));

  if (gitInfo.isDirty) {
    console.log(`  ${c.yellow('⚠')}  Working tree has uncommitted changes`);
  }

  // ── 3. Validate ───────────────────────────────────────────────────────────
  process.stdout.write('  Validating project… ');
  const validation = await validateLocal(dir, gitInfo);
  if (!validation.ok) {
    console.log(c.red('✗'));
    for (const e of validation.errors) {
      console.error(`  ${c.red('✗')}  ${e}`);
    }
    process.exit(1);
  }
  console.log(c.green('✓'));
  for (const w of validation.warnings) {
    console.log(`  ${c.yellow('⚠')}  ${w}`);
  }

  // ── 4. Framework detection ────────────────────────────────────────────────
  if (gitInfo.remoteUrl) {
    process.stdout.write('  Detecting framework… ');
    try {
      const detected = await api.detectType(gitInfo.remoteUrl, gitInfo.branch);
      console.log(
        `${c.green('✓')}  ${c.bold(detected.type)} ${c.dim(`(${detected.hint})`)}`,
      );
    } catch {
      console.log(c.dim('skipped'));
    }
  }

  // ── 5. Project resolution ──────────────────────────────────────────────────
  process.stdout.write('  Resolving project… ');
  const project = await pickProject(
    api,
    gitInfo.remoteUrl,
    flags['project-id'] ?? null,
  );
  console.log(
    `${c.green('✓')}  ${c.bold(project.name)} ${c.dim(`(${project.slug})`)}`,
  );

  // ── 6. Trigger deployment ──────────────────────────────────────────────────
  process.stdout.write('  Triggering deployment… ');
  const { deploymentId, queued } = await api.triggerDeploy(project.id);
  console.log(
    c.green('✓') + (queued ? c.dim('  (queued behind active build)') : ''),
  );
  console.log();

  // ── 7. Stream logs + live progress bar ────────────────────────────────────
  const logLines: string[] = [];
  let currentStep = '';
  let currentPercent = 5;

  printProgress(currentPercent, 'Waiting in queue…');

  try {
    for await (const evt of api.streamLogs(project.id, deploymentId)) {
      if (evt.type === 'line') {
        logLines.push(evt.text);
        const step = detectBuildStep(evt.text);
        if (step) {
          currentStep = step;
          currentPercent = STEP_PERCENT[step];
          clearProgress();
          console.log(`\n  ${c.cyan('›')}  ${c.bold(STEP_LABEL[step])}`);
          printProgress(currentPercent, STEP_LABEL[step] + '…');
        } else {
          clearProgress();
          console.log(`  ${c.dim(evt.text)}`);
          printProgress(currentPercent, currentStep ? STEP_LABEL[currentStep as BuildStep] + '…' : 'Building…');
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
    console.log(`  ${c.yellow('⚠')}  Log stream disconnected — polling for result…`);
  }

  // ── 8. Fetch final status ──────────────────────────────────────────────────
  clearProgress();

  let finalStatus: string | null = null;
  let finalLog: string | null = null;
  let subdomain: string | null = null;

  // SSE ends slightly before DB is updated — poll with exponential backoff
  let consecutiveErrors = 0;
  for (let attempt = 0; attempt < 20; attempt++) {
    const delay = Math.min(1000 * 2 ** attempt, 10_000);
    await new Promise((r) => setTimeout(r, delay));
    try {
      const s = await api.getDeploymentStatus(project.id, deploymentId);
      consecutiveErrors = 0;
      finalLog = s.buildLog;
      subdomain = s.subdomain;
      if (['DEPLOYED', 'FAILED', 'CANCELLED'].includes(s.status)) {
        finalStatus = s.status;
        break;
      }
    } catch {
      if (++consecutiveErrors >= 5) break;
    }
  }

  // ── 9. Final output ────────────────────────────────────────────────────────
  console.log();

  if (finalStatus === 'DEPLOYED') {
    console.log(c.bold(c.green('✓ Deployed successfully')));

    if (subdomain) {
      const url = buildDeployUrl(creds.apiUrl, subdomain);
      console.log(`\n  ${c.bold('Live URL')}  →  ${c.cyan(url)}`);
    }
    console.log();
    return;
  }

  if (finalStatus === 'FAILED') {
    const stepLabel = currentStep ? ` at: ${c.bold(currentStep)}` : '';
    console.log(c.bold(c.red(`✗ Deployment failed${stepLabel}`)));
    console.log();

    const log = finalLog ?? logLines.join('');
    if (log) {
      const tail = log
        .split('\n')
        .filter(Boolean)
        .slice(-20)
        .join('\n');

      console.log(`  ${c.dim('Last 20 lines of build log:')}`);
      console.log('  ' + '─'.repeat(52));
      for (const l of tail.split('\n')) {
        console.log(`  ${c.dim(l)}`);
      }
      console.log('  ' + '─'.repeat(52));
      console.log();

      const diagnosis = diagnose(log);
      if (diagnosis) {
        console.log(`  ${c.yellow('Probable cause:')}  ${diagnosis.cause}`);
        console.log(`  ${c.cyan('Suggested fix:')}   ${diagnosis.fix}`);
        console.log();
      }
    }
    process.exit(1);
  }

  // Timed out
  console.log(`${c.yellow('⚠')}  Timed out waiting for deployment to finish.`);
  console.log(
    `   Check status at: ${c.cyan(`${creds.apiUrl}/projects/${project.slug}`)}`,
  );
  process.exit(1);
}

// ── Help ─────────────────────────────────────────────────────────────────────
function cmdHelp(): void {
  console.log(`
${c.bold('dropdeploy')} — Deploy projects to DropDeploy from the CLI

${c.bold('USAGE')}
  dropdeploy <command> [flags]

${c.bold('COMMANDS')}
  ${c.cyan('deploy')}                       Deploy the current project  ${c.dim('(default)')}
    ${c.dim('--project-id <id|slug>')}      Skip project selection and deploy to a specific project
    ${c.dim('--dir <path>')}                Use a different working directory

  ${c.cyan('projects')}                     List all your projects and their status

  ${c.cyan('auth login')}                   Log in to your DropDeploy instance  ${c.dim('(default: app.en3.wtf)')}
    ${c.dim('--api-url <url>')}             Override the default URL (e.g. for local dev)
    ${c.dim('--email <email>')}             Your email
    ${c.dim('(password is always prompted interactively)')}
  ${c.cyan('auth status')}                  Show current login status
  ${c.cyan('auth logout')}                  Clear saved credentials

  ${c.cyan('help')}                         Show this help message
  ${c.cyan('--version')}                    Print the CLI version

${c.bold('ENVIRONMENT')}
  ${c.dim('DROPDEPLOY_TOKEN')}              Bearer token  ${c.dim('(skips auth login in CI)')}
  ${c.dim('DROPDEPLOY_URL')}               DropDeploy instance URL
  ${c.dim('DROPDEPLOY_EMAIL')}             Email  ${c.dim('(optional, cosmetic)')}

${c.bold('EXAMPLES')}
  ${c.dim('$')} dropdeploy auth login
  ${c.dim('$')} dropdeploy deploy
  ${c.dim('$')} dropdeploy deploy --project-id my-app
  ${c.dim('$')} dropdeploy projects
`);
}

// ── Argument parser ──────────────────────────────────────────────────────────
function parseArgs(argv: string[]): {
  command: string[];
  flags: Record<string, string>;
} {
  const command: string[] = [];
  const flags: Record<string, string> = {};
  let i = 0;
  while (i < argv.length) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const nextIsValue = argv[i + 1] && !argv[i + 1].startsWith('-');
      flags[key] = nextIsValue ? argv[++i] : 'true';
    } else if (argv[i] === '-v') {
      flags['version'] = 'true';
    } else if (argv[i] === '-h') {
      flags['help'] = 'true';
    } else {
      command.push(argv[i]);
    }
    i++;
  }
  return { command, flags };
}

// ── Entry point ───────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const [cmd, sub] = command;

  if (flags['help'] === 'true') return cmdHelp();

  if (cmd === 'version' || flags['version'] === 'true') {
    const { readFile } = await import('node:fs/promises');
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
    console.error('Unknown auth subcommand. Use: login | status | logout');
    process.exit(1);
  }

  if (cmd === 'projects') return cmdProjects();
  if (cmd === 'deploy' || cmd === undefined) return cmdDeploy(flags);
  if (cmd === 'help' || cmd === '--help' || cmd === '-h') return cmdHelp();

  console.error(`Unknown command: ${cmd}`);
  console.error('Run dropdeploy help for usage.');
  process.exit(1);
}

main().catch((err: Error) => {
  console.error(`\n${c.red('Error:')} ${err.message}`);
  process.exit(1);
});
