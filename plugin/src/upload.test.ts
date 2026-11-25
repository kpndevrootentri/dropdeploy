import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtemp, mkdir, writeFile, symlink, truncate, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { EntrifyApi } from './api.js';
import { bundleHtml, bundlePath, defaultSiteName, deploySite } from './upload.js';
import { readForm } from './test-helpers.js';

let tmp = '';
let server: Server;
let api: EntrifyApi;
const posts: Array<{ path: string; name: unknown; file: File }> = [];
let quota: { used: number; limit: number; available: number } | undefined; // left out of GET /api/projects while undefined
const projects = [
  { id: 'p1', name: 'Portfolio', slug: 'portfolio', type: 'STATIC', source: 'UPLOAD', githubUrl: null },
  { id: 'p2', name: 'my-app', slug: 'my-app', type: 'NODEJS', source: 'GITHUB', githubUrl: 'https://github.com/me/my-app' },
];

before(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'entrify-upload-'));
  server = createServer(async (req, res) => {
    const reply = (data: unknown) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ success: true, data }));
    if (req.method === 'GET') return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ success: true, data: projects, quota }));
    const form = await readForm(req);
    posts.push({ path: req.url ?? '', name: form.get('name'), file: form.get('file') as File });
    const project = req.url === '/api/projects/upload' ? { id: 'p3', name: String(form.get('name')), slug: 'fresh-site', source: 'UPLOAD' } : projects[0];
    reply({ project, deployment: { id: 'd1', status: 'DEPLOYED' }, url: `https://${project.slug}.entrify.site` });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  api = new EntrifyApi({ token: 't', email: 'e', apiUrl: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}` });
});

after(async () => {
  server.close();
  await rm(tmp, { recursive: true, force: true });
});

test('bundlePath zips a folder without dotfiles, node_modules or symlinks', async () => {
  const site = join(tmp, 'site');
  const outside = join(tmp, 'outside');
  await mkdir(join(site, '.git'), { recursive: true });
  await mkdir(join(site, 'node_modules'));
  await mkdir(join(site, 'assets'));
  await mkdir(outside);
  await writeFile(join(outside, 'secret.txt'), 'secret');
  await writeFile(join(site, 'index.html'), '<h1>hi</h1>');
  await writeFile(join(site, 'style.css'), 'h1{}');
  await writeFile(join(site, 'assets', 'app.js'), 'go()');
  await writeFile(join(site, 'resume.pdf'), '%PDF'); // a type the server would drop
  await writeFile(join(site, '.env'), 'KEY=1');
  await writeFile(join(site, '.git', 'config'), '[core]');
  await writeFile(join(site, 'node_modules', 'x.js'), 'x');
  await symlink(join(outside, 'secret.txt'), join(site, 'secret.txt'));
  await symlink(outside, join(site, 'linked'));

  const bundle = await bundlePath(site);
  assert.deepEqual(bundle.files, ['assets/app.js', 'index.html', 'style.css']);
  assert.deepEqual(bundle.skipped, ['resume.pdf']);
  assert.match(bundle.filename, /\.zip$/);
  assert.deepEqual(Object.keys(unzipSync(bundle.bytes)).sort(), bundle.files);
});

test('bundlePath reports what the server drops from a .zip, and refuses more than 500 files', async () => {
  const zip = join(tmp, 'site.zip');
  await writeFile(zip, zipSync({ 'index.html': strToU8('<p>'), 'notes.md': strToU8('#') }));
  const bundle = await bundlePath(zip);
  assert.deepEqual([bundle.files, bundle.skipped], [['index.html'], ['notes.md']]);

  const crowded = join(tmp, 'crowded');
  await mkdir(crowded);
  await Promise.all(Array.from({ length: 501 }, (_, i) => writeFile(join(crowded, i ? `p${i}.html` : 'index.html'), '<p>')));
  await assert.rejects(bundlePath(crowded), { code: 'TOO_MANY_FILES', exitCode: 2 });
});

test('bundlePath refuses a folder without index.html, and anything over 50 MB', async () => {
  await mkdir(join(tmp, 'no-index'));
  await writeFile(join(tmp, 'no-index', 'page.html'), '<p>');
  await writeFile(join(tmp, 'no-index', 'Index.html'), '<p>'); // the server wants exactly index.html, even where the disk ignores case
  await assert.rejects(bundlePath(join(tmp, 'no-index')), { code: 'NO_INDEX_HTML', exitCode: 2 });

  const source = join(tmp, 'vite-app'); // a project's source has index.html at its root too
  await mkdir(source);
  await writeFile(join(source, 'index.html'), '<script type="module" src="/src/main.tsx"></script>');
  await writeFile(join(source, 'package.json'), '{}');
  await assert.rejects(bundlePath(source), { code: 'PROJECT_SOURCE', exitCode: 2 });

  if (process.getuid?.() !== 0) { // root can read anything
    const locked = join(tmp, 'locked');
    await mkdir(join(locked, 'site'), { recursive: true });
    await chmod(locked, 0o000);
    try {
      await assert.rejects(bundlePath(join(locked, 'site')), { code: 'EACCES' }); // not "does not exist"
    } finally {
      await chmod(locked, 0o755);
    }
  }

  const big = join(tmp, 'big.html');
  await writeFile(big, '');
  await truncate(big, 50 * 1024 * 1024 + 1); // sparse: no real disk use
  await assert.rejects(bundlePath(big), { code: 'TOO_LARGE', exitCode: 2 });
  await assert.rejects(bundlePath(join(tmp, 'missing.html')), { code: 'INVALID_PATH' });
});

test('defaultSiteName names a site after its file or folder', () => {
  assert.equal(defaultSiteName('/work/portfolio/index.html'), 'portfolio');
  assert.equal(defaultSiteName('/work/My Page (1).html'), 'My Page -1');
  assert.equal(defaultSiteName('/work/launch.zip'), 'launch');
  assert.equal(defaultSiteName('/work/my-site'), 'my-site');
  assert.throws(() => defaultSiteName('/work/a!.html'), { code: 'INVALID_NAME', exitCode: 2 });
});

test('bundleHtml zips extra files and rejects paths that escape the site', () => {
  assert.deepEqual(bundleHtml('<h1>x</h1>').files, ['index.html']);
  const zipped = bundleHtml('<h1>x</h1>', { 'css/style.css': 'h1{}' });
  assert.deepEqual(zipped.files, ['css/style.css', 'index.html']);
  assert.equal(new TextDecoder().decode(unzipSync(zipped.bytes)['css/style.css']), 'h1{}');
  for (const key of ['../x', '/x', 'a/../b', 'index.html', 'a\\b', '', 'notes.md']) {
    assert.throws(() => bundleHtml('<p>', { [key]: 'x' }), { code: 'INVALID_INPUT' }, key);
  }
  assert.throws(() => bundleHtml(''), { code: 'INVALID_INPUT' });
});

test('deploySite never overwrites a site unless asked to', async () => {
  const bundle = bundleHtml('<h1>hello</h1>');

  await assert.rejects(deploySite(api, bundle, { name: ' portfolio ' }), (err: { code: string; message: string; details: unknown }) => {
    assert.equal(err.code, 'NAME_TAKEN');
    assert.match(err.message, /--project-id portfolio/);
    assert.deepEqual(err.details, { project: { id: 'p1', slug: 'portfolio', name: 'Portfolio' } });
    return true;
  });
  await assert.rejects(deploySite(api, bundle, { name: 'MY-APP' }), { code: 'NAME_TAKEN', message: /deployed from git/ });
  await assert.rejects(deploySite(api, bundle, { name: 'x', projectId: 'my-app' }), { code: 'NOT_UPLOAD_PROJECT', exitCode: 2 });
  await assert.rejects(deploySite(api, bundle, { name: 'x', projectId: 'nope' }), { code: 'PROJECT_NOT_FOUND' });
  await assert.rejects(deploySite(api, bundle, { name: 'my.site', dryRun: true }), { code: 'INVALID_NAME', exitCode: 2 });
  await assert.rejects(deploySite(api, bundle, { name: 'my.site' }), { code: 'INVALID_NAME' });
  quota = { used: 2, limit: 2, available: 0 };
  await assert.rejects(deploySite(api, bundle, { name: 'Fresh Site', dryRun: true }), { code: 'QUOTA_EXCEEDED', exitCode: 2 });
  assert.equal((await deploySite(api, bundle, { name: '', projectId: 'portfolio', dryRun: true })).created, false, 'a new version needs no free project');
  quota = undefined;
  assert.deepEqual(
    await deploySite(api, bundle, { name: 'Fresh Site', dryRun: true }),
    { url: null, project: null, created: true, dryRun: true, files: ['index.html'], skipped: [] },
  );
  assert.equal(posts.length, 0, 'no upload for a taken or invalid name, a bad project or a dry run');

  const version = await deploySite(api, bundle, { name: 'ignored', projectId: 'portfolio' });
  assert.equal(posts[0].path, '/api/projects/p1/upload');
  assert.equal(posts[0].name, null);
  assert.deepEqual([version.created, version.url], [false, 'https://portfolio.entrify.site']);

  const fresh = await deploySite(api, bundle, { name: 'Fresh Site' });
  assert.equal(posts[1].path, '/api/projects/upload');
  assert.equal(posts[1].name, 'Fresh Site');
  assert.equal(posts[1].file.name, 'index.html');
  assert.equal(await posts[1].file.text(), '<h1>hello</h1>');
  assert.deepEqual(fresh, { url: 'https://fresh-site.entrify.site', project: { id: 'p3', slug: 'fresh-site', name: 'Fresh Site' }, created: true, dryRun: false, files: ['index.html'], skipped: [] });
});
