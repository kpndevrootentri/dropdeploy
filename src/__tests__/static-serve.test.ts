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

  describe('edge hand-off', () => {
    /** What the edge would send: the file named under its root (STATIC_SERVE_DIR), or null. */
    const handOff = async (p: string, opts: { ifNoneMatch?: string; slug?: string } = {}) => {
      const res = (await serveStaticFile(dir, p, { ...opts, edgeRoot: path.dirname(dir) }))!;
      return { status: res.status, body: await res.text(), file: res.headers.get('x-entrify-static-file'), res };
    };

    it('names the file for the edge instead of sending it, with its cache headers and no validator or 304', async () => {
      dir = await site({ 'index.html': 'shell', 'assets/app.js': 'js' });
      const { etag } = await get(dir, '/assets/app.js');
      const { status, body, file, res } = await handOff('/assets/app.js', { ifNoneMatch: etag! });
      expect({ status, body, file }).toEqual({ status: 200, body: '', file: `/${path.basename(dir)}/assets/app.js` });
      expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
      expect(res.headers.get('content-type')).toBe('application/javascript; charset=utf-8');
      expect(res.headers.get('etag')).toBeNull();
      // Relative to the edge's root, wherever the site folder sits under it.
      const nested = await serveStaticFile(dir, '/assets/app.js', { edgeRoot: path.dirname(path.dirname(dir)) });
      expect(nested!.headers.get('x-entrify-static-file'))
        .toBe(`/${path.basename(path.dirname(dir))}/${path.basename(dir)}/assets/app.js`);
    });

    it('keeps the path rules, and sends the 404 page itself', async () => {
      dir = await site({ 'index.html': 'shell', 'about.html': 'about', '.env': 'SECRET=1' });
      const base = `/${path.basename(dir)}`;
      expect((await handOff('/dashboard/settings')).file).toBe(`${base}/index.html`);
      expect((await handOff('/about')).file).toBe(`${base}/about.html`);
      for (const p of ['/missing.js', '/.env', '/../../etc/passwd']) {
        expect(await handOff(p)).toMatchObject({ status: 404, file: null });
      }
      await fs.promises.writeFile(path.join(dir, '404.html'), 'nope');
      expect(await handOff('/no-such-page')).toMatchObject({ status: 404, body: 'nope', file: null });
    });

    it('percent-encodes each segment, since the edge decodes the path it is given', async () => {
      dir = await site({ 'My Photo #1/ünï?%.jpg': 'img' });
      expect((await handOff('/My Photo #1/ünï?%.jpg')).file)
        .toBe(`/${path.basename(dir)}/My%20Photo%20%231/%C3%BCn%C3%AF%3F%25.jpg`);
    });

    it('sends HTML rewritten for local dev itself', async () => {
      dir = await site({ 'index.html': '<html><head></head><script src="/app.js"></script></html>' });
      const { body, file } = await handOff('/', { slug: 'shop' });
      expect(file).toBeNull();
      expect(body).toContain('src="/api/proxy/shop/app.js"');
    });
  });
});
