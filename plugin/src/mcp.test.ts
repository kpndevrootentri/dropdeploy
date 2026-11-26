// End-to-end: runs `entrify mcp` (through tsx) against a fake Entrify API and speaks JSON-RPC to it over stdio.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { readForm } from './test-helpers.js';

const CLI = fileURLToPath(new URL('./cli.ts', import.meta.url));
const TSX = import.meta.resolve('tsx');
const TOKEN = 'mcp-token';

const projects = [
  { id: 'p1', name: 'Taken Site', slug: 'taken-site', type: 'STATIC', source: 'UPLOAD', githubUrl: null, updatedAt: '2026-11-01T00:00:00.000Z' },
  { id: 'p2', name: 'Git App', slug: 'git-app', type: 'NEXTJS', source: 'GITHUB', githubUrl: 'https://github.com/me/git-app' },
];
const uploadedNames: string[] = [];
let tokenExpired = false;
let server: Server;
let baseUrl = '';
let home = '';

const send = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (tokenExpired || req.headers.authorization !== `Bearer ${TOKEN}`) return send(res, 401, { error: 'Not authenticated' });
  if (req.url === '/api/projects' && req.method === 'GET') {
    return send(res, 200, { success: true, data: projects, quota: { used: projects.length, limit: 5, available: 5 - projects.length } });
  }
  if (req.url === '/api/projects/upload' && req.method === 'POST') {
    const form = await readForm(req);
    uploadedNames.push((form.get('file') as File).name);
    const name = String(form.get('name'));
    const project = { id: `p${projects.length + 1}`, name, slug: name.toLowerCase().replace(/ /g, '-'), type: 'STATIC', source: 'UPLOAD', githubUrl: null };
    projects.push(project);
    return send(res, 200, { success: true, data: { project, deployment: { id: 'u1', status: 'DEPLOYED' }, url: `${baseUrl}/api/proxy/${project.slug}` } });
  }
  return send(res, 404, { error: { message: `No route ${req.method} ${req.url}` } });
}

before(async () => {
  server = createServer((req, res) => void handle(req, res).catch((e: Error) => send(res, 500, { error: e.message })));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  home = await mkdtemp(join(tmpdir(), 'entrify-mcp-home-'));
});

after(async () => {
  server.close();
  await rm(home, { recursive: true, force: true });
});

/** The result fields these tests read; each reply carries only the ones its method returns. */
interface Message { id?: number | null; result?: { [key: string]: unknown; instructions: string; content: { text: string }[] }; error?: { code: number; message: string } }

/** Starts `entrify mcp` with a temp HOME and APPDATA, so the real saved login is never read. */
function startMcp(token: string | undefined) {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, APPDATA: home, ENTRIFY_TOKEN: token, ENTRIFY_URL: baseUrl };
  if (token === undefined) delete env.ENTRIFY_TOKEN;
  delete env.DROPDEPLOY_TOKEN;
  delete env.DROPDEPLOY_URL;
  const child = spawn(process.execPath, ['--import', TSX, CLI, 'mcp'], { env });

  const lines: string[] = [];
  const waiting = new Map<number | null, (m: Message) => void>();
  createInterface({ input: child.stdout }).on('line', (line) => {
    lines.push(line);
    try {
      const m = JSON.parse(line) as Message;
      waiting.get(m.id ?? null)?.(m);
    } catch { /* asserted below */ }
  });
  const reply = (id: number | null) => new Promise<Message>((r) => waiting.set(id, r));
  const write = (msg: object) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
  const request = (id: number, method: string, params?: object) => {
    const r = reply(id);
    write({ id, method, params });
    return r;
  };
  const call = async (id: number, args: object, name = 'deploy_to_entrify') => (await request(id, 'tools/call', { name, arguments: args })).result!;
  return { child, lines, reply, write, request, call };
}

test('mcp server answers requests, deploys HTML, reports errors as tool results, and writes only JSON-RPC to stdout', { timeout: 30_000 }, async () => {
  const { child, lines, reply, write, request, call } = startMcp(TOKEN);

  // One message split across two writes.
  const init = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
  const initReply = reply(1);
  child.stdin.write(init.slice(0, 20));
  await new Promise((r) => setTimeout(r, 50));
  child.stdin.write(init.slice(20) + '\n');
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  const { instructions, ...initResult } = (await initReply).result!;
  assert.deepEqual(initResult, { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'entrify', version } });
  assert.match(instructions, /call list_my_sites first/i);
  assert.match(instructions, /give the user the URL/);

  write({ method: 'notifications/initialized' });
  assert.deepEqual((await request(2, 'ping')).result, {});

  type Tool = { name: string; title: string; inputSchema: { properties: object; required?: string[] }; annotations: Record<string, boolean> };
  const tools = (await request(3, 'tools/list')).result!.tools as Tool[];
  assert.deepEqual(tools.map((t) => t.name), ['list_my_sites', 'deploy_to_entrify']);
  const [list, deploy] = tools;
  assert.deepEqual(list.annotations, { readOnlyHint: true, openWorldHint: true });
  assert.deepEqual(list.inputSchema.properties, {});
  assert.deepEqual(deploy.annotations, { readOnlyHint: false, destructiveHint: true, openWorldHint: true });
  assert.deepEqual(Object.keys(deploy.inputSchema.properties).sort(), ['files', 'html', 'name', 'project_id']);
  assert.deepEqual(deploy.inputSchema.required, ['name', 'html']);
  assert.ok(list.title && deploy.title);

  const ok = await call(4, { name: 'My Page', html: '<h1>Hi</h1>', files: { 'style.css': 'h1 { color: red }' } });
  const url = `${baseUrl}/api/proxy/my-page`;
  assert.equal(ok.isError, undefined);
  assert.deepEqual(ok.structuredContent, { url, project: { id: 'p3', slug: 'my-page', name: 'My Page' }, created: true, files: ['index.html', 'style.css'] });
  assert.match(ok.content[0].text, new RegExp(url));
  assert.deepEqual(uploadedNames, ['site.zip']);

  const taken = await call(5, { name: 'taken site', html: '<p>x</p>' });
  assert.equal(taken.isError, true);
  assert.match(taken.content[0].text, /NAME_TAKEN.*call deploy_to_entrify again with project_id "taken-site"/);
  assert.doesNotMatch(taken.content[0].text, /--/);
  const takenByGit = await call(9, { name: 'Git App', html: '<p>x</p>' });
  assert.match(takenByGit.content[0].text, /deployed from git.*Choose another name/);
  assert.doesNotMatch(takenByGit.content[0].text, /project_id|--/);
  assert.match((await call(10, { name: 'x', html: '<p>x</p>', project_id: 'nope' })).content[0].text, /PROJECT_NOT_FOUND.*list_my_sites/);
  assert.match((await call(11, { name: 'x', html: '<p>x</p>', project_id: 'git-app' })).content[0].text, /NOT_UPLOAD_PROJECT.*Leave out project_id/);
  assert.match((await call(12, { name: 'a.b', html: '<p>x</p>' })).content[0].text, /INVALID_NAME.*choose a name/);

  const sites = await call(13, {}, 'list_my_sites');
  assert.equal(sites.isError, undefined);
  assert.deepEqual(sites.structuredContent, {
    sites: [
      { name: 'Taken Site', slug: 'taken-site', url: `${baseUrl}/api/proxy/taken-site`, source: 'UPLOAD', updatedAt: '2026-11-01T00:00:00.000Z' },
      { name: 'Git App', slug: 'git-app', url: `${baseUrl}/api/proxy/git-app`, source: 'GITHUB' },
      { name: 'My Page', slug: 'my-page', url, source: 'UPLOAD' },
    ],
    quota: { used: 3, limit: 5, available: 2 },
  });
  assert.match(sites.content[0].text, /taken-site.*\/api\/proxy\/taken-site\n.*\n.*\n2 new site\(s\) left/);

  tokenExpired = true;
  const expired = await call(14, {}, 'list_my_sites');
  tokenExpired = false;
  assert.equal(expired.isError, true);
  assert.match(expired.content[0].text, /AUTH_EXPIRED.*\/settings#api-tokens.*Entrify extension in Claude Desktop \(Settings > Extensions, or Settings > Desktop app > Manage next to Extensions\)/);

  const unsafe = await call(6, { name: 'Unsafe', html: '<p>x</p>', files: { '../x': 'y' } });
  assert.equal(unsafe.isError, true);
  assert.match(unsafe.content[0].text, /INVALID_INPUT.*\.\.\/x/);
  assert.equal(uploadedNames.length, 1, 'refused calls must not upload');

  assert.equal((await request(7, 'tools/call', { name: 'rm_rf' })).error?.code, -32602);
  assert.equal((await request(8, 'resources/list')).error?.code, -32601);

  const parseError = reply(null);
  child.stdin.write('this is not json\n');
  assert.equal((await parseError).error?.code, -32700);

  child.stdin.end();
  const [exitCode] = await once(child, 'exit');
  assert.equal(exitCode, 0);
  const parsed = lines.map((line) => JSON.parse(line) as Message);
  // Fourteen requests plus the parse error; the notification got no reply.
  assert.deepEqual(parsed.map((m) => m.id).sort(), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, null].sort());
});

test('without a token, the tools say how to add one in Claude Desktop', { timeout: 30_000 }, async () => {
  const { child, lines, call } = startMcp(undefined);
  for (const [id, name] of [[1, 'list_my_sites'], [2, 'deploy_to_entrify']] as const) {
    const out = await call(id, { name: 'My Page', html: '<p>x</p>' }, name);
    assert.equal(out.isError, true);
    assert.match(out.content[0].text, /^Entrify needs an API token\. Create one at http:\/\/127\.0\.0\.1:\d+\/settings#api-tokens, then paste it into the Entrify extension in Claude Desktop \(Settings > Extensions, or Settings > Desktop app > Manage next to Extensions\)\. In a terminal, run entrify auth login instead\.$/);
  }
  child.stdin.end();
  await once(child, 'exit');
  for (const line of lines) JSON.parse(line);
  assert.equal(uploadedNames.length, 1, 'no upload without a token');
});
