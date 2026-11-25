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

const projects = [{ id: 'p1', name: 'Taken Site', slug: 'taken-site', type: 'STATIC', source: 'UPLOAD', githubUrl: null }];
const uploadedNames: string[] = [];
let server: Server;
let baseUrl = '';
let home = '';

const send = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(res, 401, { error: 'Not authenticated' });
  if (req.url === '/api/projects' && req.method === 'GET') return send(res, 200, { success: true, data: projects });
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

interface Message { id?: number | null; result?: Record<string, any>; error?: { code: number; message: string } }

test('mcp server answers requests, deploys HTML, reports errors as tool results, and writes only JSON-RPC to stdout', { timeout: 30_000 }, async () => {
  // A temp HOME and APPDATA, so the real saved login is never read.
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, APPDATA: home, ENTRIFY_TOKEN: TOKEN, ENTRIFY_URL: baseUrl };
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
  const call = async (id: number, args: object) => (await request(id, 'tools/call', { name: 'deploy_to_entrify', arguments: args })).result!;

  // One message split across two writes.
  const init = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
  const initReply = reply(1);
  child.stdin.write(init.slice(0, 20));
  await new Promise((r) => setTimeout(r, 50));
  child.stdin.write(init.slice(20) + '\n');
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  assert.deepEqual((await initReply).result, {
    protocolVersion: '2025-03-26',
    capabilities: { tools: {} },
    serverInfo: { name: 'entrify', version },
  });

  write({ method: 'notifications/initialized' });
  assert.deepEqual((await request(2, 'ping')).result, {});

  const tools = (await request(3, 'tools/list')).result!.tools as Array<{ name: string; inputSchema: { properties: object; required: string[] } }>;
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'deploy_to_entrify');
  assert.deepEqual(Object.keys(tools[0].inputSchema.properties).sort(), ['files', 'html', 'name', 'project_id']);
  assert.deepEqual(tools[0].inputSchema.required, ['name', 'html']);

  const ok = await call(4, { name: 'My Page', html: '<h1>Hi</h1>', files: { 'style.css': 'h1 { color: red }' } });
  const url = `${baseUrl}/api/proxy/my-page`;
  assert.equal(ok.isError, undefined);
  assert.deepEqual(ok.structuredContent, { url, project: { id: 'p2', slug: 'my-page', name: 'My Page' }, created: true, files: ['index.html', 'style.css'] });
  assert.match(ok.content[0].text, new RegExp(url));
  assert.deepEqual(uploadedNames, ['site.zip']);

  const taken = await call(5, { name: 'taken site', html: '<p>x</p>' });
  assert.equal(taken.isError, true);
  assert.match(taken.content[0].text, /NAME_TAKEN/);

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
  // Eight requests plus the parse error; the notification got no reply.
  assert.deepEqual(parsed.map((m) => m.id).sort(), [1, 2, 3, 4, 5, 6, 7, 8, null].sort());
});
