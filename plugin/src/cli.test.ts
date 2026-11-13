// End-to-end: runs the real CLI (through tsx) against a fake Entrify API, in a throwaway git repo.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const CLI = fileURLToPath(new URL('./cli.ts', import.meta.url));
const TSX = import.meta.resolve('tsx');
const TOKEN = 'test-token';

interface Dep { id: string; status: string; subdomain: string | null; createdAt: string; buildLog: string }
const state = {
  projects: [] as Array<{ id: string; name: string; slug: string; type: string; source: string; githubUrl: string | null; branch: string }>,
  deployments: new Map<string, Dep[]>(),
  env: new Map<string, Array<{ id: string; key: string; value: string; environment: string }>>(),
  nextDeployStatus: 'DEPLOYED',
  cancelled: [] as string[],
};

let server: Server;
let baseUrl = '';
let repo = '';
let home = '';

const send = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};
const body = async (req: IncomingMessage): Promise<Record<string, string>> => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
};

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(res, 401, { error: 'Not authenticated' });
  const url = new URL(req.url ?? '/', baseUrl);
  const parts = url.pathname.split('/').filter(Boolean); // ['api', 'projects', id, ...]
  const ok = (data: unknown) => send(res, 200, { success: true, data });

  if (url.pathname === '/api/detect-type') return ok({ type: 'NODEJS', confidence: 'high', hint: 'package.json' });
  if (url.pathname === '/api/projects' && req.method === 'GET') {
    return ok(state.projects.map((p) => ({ ...p, deployments: (state.deployments.get(p.id) ?? []).slice(0, 1) })));
  }
  if (url.pathname === '/api/projects' && req.method === 'POST') {
    const dto = await body(req);
    const project = { id: `p${state.projects.length + 1}`, name: dto.name, slug: dto.name, type: dto.type ?? 'STATIC', source: dto.source, githubUrl: dto.githubUrl, branch: dto.branch ?? 'main' };
    state.projects.push(project);
    return ok(project);
  }

  const [, , projectId, section, deploymentId, action] = parts;
  const deps = state.deployments.get(projectId) ?? [];
  state.deployments.set(projectId, deps);
  const env = state.env.get(projectId) ?? [];
  state.env.set(projectId, env);

  if (section === 'deploy' || action === 'rollback') {
    const failed = state.nextDeployStatus === 'FAILED';
    const dep: Dep = {
      id: `d${deps.length + 1}`,
      status: state.nextDeployStatus,
      subdomain: failed ? null : state.projects.find((p) => p.id === projectId)?.slug ?? null,
      createdAt: new Date().toISOString(),
      buildLog: failed ? '▶ Starting container\nThe app did not start listening within 90s.\n' : '▶ Cloning repository\nok\n',
    };
    deps.unshift(dep);
    return ok({ deploymentId: dep.id, queued: false });
  }
  if (section === 'deployments' && !deploymentId) return ok({ deployments: deps, total: deps.length });
  const dep = deps.find((d) => d.id === deploymentId);
  if (section === 'deployments' && action === 'logs' && parts[6] === 'stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const text of (dep?.buildLog ?? '').split('\n').filter(Boolean)) res.write(`data: ${JSON.stringify({ type: 'line', text })}\n\n`);
    return void res.end(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
  }
  if (section === 'deployments' && action === 'logs') {
    return ok({ status: dep?.status, buildLog: dep?.buildLog ?? null, commitHash: 'abc123', subdomain: dep?.subdomain ?? null });
  }
  if (section === 'deployments' && action === 'cancel') {
    state.cancelled.push(deploymentId);
    return ok({});
  }

  if (section === 'env-vars') {
    const varId = deploymentId;
    if (req.method === 'GET') return ok(env.map(({ id, key, environment }) => ({ id, key, environment })));
    if (req.method === 'POST') {
      const dto = await body(req);
      if (env.some((v) => v.key === dto.key)) return send(res, 409, { error: { message: 'exists' } });
      env.push({ id: `v${env.length + 1}-${dto.key}`, key: dto.key, value: dto.value, environment: 'ALL' });
      return send(res, 201, { success: true, data: {} });
    }
    const found = env.find((v) => v.id === varId);
    if (!found) return send(res, 404, { error: { message: 'Environment variable not found' } });
    if (req.method === 'PUT') {
      found.value = (await body(req)).value;
      return ok({});
    }
    env.splice(env.indexOf(found), 1);
    return send(res, 200, { success: true });
  }
  return send(res, 404, { error: { message: `No route ${req.method} ${url.pathname}` } });
}

/** Runs the CLI with --json; resolves to the exit code and the parsed JSON stdout (exactly one line). */
async function cli(...args: string[]): Promise<{ code: number; out: Record<string, unknown> }> {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, ENTRIFY_TOKEN: TOKEN, ENTRIFY_URL: baseUrl };
  delete env.DROPDEPLOY_TOKEN;
  delete env.DROPDEPLOY_URL;
  if (args[0] === '--logged-out') {
    args.shift();
    delete env.ENTRIFY_TOKEN;
  }
  let stdout: string;
  let code = 0;
  try {
    ({ stdout } = await run(process.execPath, ['--import', TSX, CLI, ...args, '--json'], { cwd: repo, env }));
  } catch (err) {
    const e = err as { code: number; stdout: string };
    code = e.code;
    stdout = e.stdout;
  }
  const lines = stdout.trim().split('\n');
  assert.equal(lines.length, 1, `stdout must be one JSON line, got:\n${stdout}`);
  return { code, out: JSON.parse(lines[0]) as Record<string, unknown> };
}

before(async () => {
  server = createServer((req, res) => void handle(req, res).catch((e: Error) => send(res, 500, { error: e.message })));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  repo = await mkdtemp(join(tmpdir(), 'entrify-cli-repo-'));
  home = await mkdtemp(join(tmpdir(), 'entrify-cli-home-'));
  const git = (...a: string[]) => run('git', a, { cwd: repo });
  await git('init', '-q', '-b', 'main');
  await git('remote', 'add', 'origin', 'git@github.com:me/my-app.git');
  await writeFile(join(repo, 'package.json'), JSON.stringify({ scripts: { start: 'node index.js' } }));
});

after(async () => {
  server.close();
  await rm(repo, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
});

test('auth status reports the login, and exits 3 without one', async () => {
  assert.deepEqual(await cli('auth', 'status'), { code: 0, out: { ok: true, email: 'env', apiUrl: baseUrl } });
  const { code, out } = await cli('--logged-out', 'auth', 'status');
  assert.equal(code, 3);
  assert.equal((out.error as { code: string }).code, 'NOT_LOGGED_IN');
});

test('deploy without a matching project asks for input instead of prompting', async () => {
  const { code, out } = await cli('deploy');
  assert.equal(code, 2);
  assert.equal(out.ok, false);
  assert.equal((out.error as { code: string }).code, 'NO_PROJECTS');
  assert.match((out.error as { message: string }).message, /--create/);
});

test('deploy --create makes the project from the remote and reports the live URL', async () => {
  const { code, out } = await cli('deploy', '--create');
  assert.equal(code, 0);
  assert.equal(out.status, 'DEPLOYED');
  assert.equal(out.created, true);
  assert.deepEqual(out.project, { id: 'p1', slug: 'my-app', name: 'my-app' });
  assert.equal(out.url, `${baseUrl}/api/proxy/my-app`);
  assert.equal(state.projects[0].githubUrl, 'https://github.com/me/my-app');
  assert.equal(state.projects[0].type, 'NODEJS');
});

test('a failed deploy exits 1 with the cause, the fix and the log tail', async () => {
  state.nextDeployStatus = 'FAILED';
  const { code, out } = await cli('deploy');
  state.nextDeployStatus = 'DEPLOYED';
  assert.equal(code, 1);
  assert.equal((out.error as { code: string }).code, 'DEPLOY_FAILED');
  assert.equal(out.created, false);
  assert.match(String(out.cause), /never accepted connections/);
  assert.match(String(out.fix), /0\.0\.0\.0/);
  assert.ok((out.logTail as string[]).some((l) => l.includes('did not start listening')));
});

test('status and logs describe the latest deployment', async () => {
  const status = await cli('status');
  assert.equal(status.code, 0);
  assert.equal((status.out.latest as { status: string }).status, 'FAILED');
  assert.equal(status.out.url, `${baseUrl}/api/proxy/my-app`, 'the earlier successful deploy is still live');

  const logs = await cli('logs', '--lines', '1');
  assert.deepEqual(logs.out.lines, ['The app did not start listening within 90s.']);
  assert.equal(logs.out.status, 'FAILED');
});

test('env set, push, list and unset never echo values', async () => {
  const set = await cli('env', 'set', 'A=1', 'B=x=y');
  assert.deepEqual([set.out.created, set.out.updated], [['A', 'B'], []]);

  await writeFile(join(repo, '.env.test'), 'A=2\n# comment\nC="one"\nC="three"\n');
  const push = await cli('env', 'push', '.env.test');
  assert.deepEqual([push.out.created, push.out.updated], [['C'], ['A']]);
  assert.deepEqual(state.env.get('p1')?.map((v) => [v.key, v.value]), [['A', '2'], ['B', 'x=y'], ['C', 'three']]);

  const list = await cli('env', 'list');
  assert.deepEqual(list.out.variables, ['A', 'B', 'C'].map((key) => ({ key, environment: 'ALL' })));
  assert.doesNotMatch(JSON.stringify(list.out), /three|x=y/);

  const unset = await cli('env', 'unset', 'B', 'NOPE');
  assert.deepEqual([unset.out.removed, unset.out.missing], [['B'], ['NOPE']]);

  const bad = await cli('env', 'set', 'NOVALUE');
  assert.equal(bad.code, 2);
});

test('rollback returns to the deployment before the live one; cancel needs an active one', async () => {
  // Newest first: d2 FAILED, d1 DEPLOYED (live). A new success (d3) makes d1 the deployment before the live one.
  await cli('deploy');
  const rb = await cli('rollback');
  assert.equal(rb.code, 0);
  assert.equal(rb.out.rolledBackTo, 'd1');
  assert.equal(rb.out.status, 'DEPLOYED');

  const none = await cli('rollback', '--project-id', 'missing');
  assert.equal((none.out.error as { code: string }).code, 'PROJECT_NOT_FOUND');

  const cancel = await cli('cancel');
  assert.equal(cancel.code, 2);
  assert.equal((cancel.out.error as { code: string }).code, 'NOTHING_TO_CANCEL');
});

test('unknown commands exit 2 with a usage error', async () => {
  const { code, out } = await cli('frobnicate');
  assert.equal(code, 2);
  assert.equal((out.error as { code: string }).code, 'USAGE');
});
