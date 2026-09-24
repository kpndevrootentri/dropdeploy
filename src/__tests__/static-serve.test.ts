import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { serveStaticFile } from '@/lib/static-serve';

async function site(files: Record<string, string>): Promise<string> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'site-'));
  for (const [name, body] of Object.entries(files)) {
    await fs.promises.mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await fs.promises.writeFile(path.join(dir, name), body);
  }
  return dir;
}

async function get(dir: string, p: string, ifNoneMatch?: string): Promise<{ status: number; body: string; etag: string | null }> {
  const res = await serveStaticFile(dir, p, { ifNoneMatch });
  if (!res) return { status: -1, body: '', etag: null };
  return { status: res.status, body: res.status === 304 ? '' : await res.text(), etag: res.headers.get('etag') };
}

describe('serveStaticFile', () => {
  let dir: string;
  afterEach(async () => { await fs.promises.rm(dir, { recursive: true, force: true }); });

  describe('single-page app (no 404.html)', () => {
    beforeEach(async () => { dir = await site({ 'index.html': 'shell', 'assets/app.js': 'js' }); });

    it('serves files', async () => {
      expect(await get(dir, '/assets/app.js')).toMatchObject({ status: 200, body: 'js' });
    });

    it('falls back to the app shell for client-side routes', async () => {
      expect(await get(dir, '/dashboard/settings')).toMatchObject({ status: 200, body: 'shell' });
    });

    it('returns 404 for a missing asset instead of HTML', async () => {
      expect(await get(dir, '/assets/missing.js')).toMatchObject({ status: 404 });
    });
  });

  describe('multi-page site (Next.js export)', () => {
    beforeEach(async () => {
      dir = await site({ 'index.html': 'home', 'about.html': 'about', 'blog/index.html': 'blog', '404.html': 'nope' });
    });

    it('resolves /about to about.html', async () => {
      expect(await get(dir, '/about')).toMatchObject({ status: 200, body: 'about' });
    });

    it('resolves directory routes, with or without a trailing slash', async () => {
      expect(await get(dir, '/blog')).toMatchObject({ status: 200, body: 'blog' });
      expect(await get(dir, '/blog/')).toMatchObject({ status: 200, body: 'blog' });
    });

    it("serves the site's own 404 page with status 404", async () => {
      expect(await get(dir, '/no-such-page')).toMatchObject({ status: 404, body: 'nope' });
    });
  });

  it('answers a matching If-None-Match with 304', async () => {
    dir = await site({ 'index.html': 'home' });
    const first = await get(dir, '/');
    expect(first.etag).toBeTruthy();
    expect((await get(dir, '/', first.etag!)).status).toBe(304);
  });

  it('never serves dotfiles or escapes the site directory', async () => {
    dir = await site({ 'index.html': 'home', '.env': 'SECRET=1' });
    expect((await get(dir, '/.env')).status).toBe(404);
    expect((await get(dir, '/../../etc/passwd')).body).not.toContain('root:');
  });
});
