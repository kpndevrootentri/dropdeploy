/**
 * Serves a deployed static site (STATIC_FILES serving method) from disk.
 *
 * Route resolution, for a request path P:
 *   1. P itself, if it is a file
 *   2. P + ".html"          — Next.js `output: 'export'`, Astro, Hugo, … (/about → about.html)
 *   3. P + "/index.html"    — directory-style routes
 * and when nothing matches:
 *   - a path with a file extension (/logo.png, /app.js) is a missing asset: 404
 *   - otherwise, the site's own 404.html with status 404 if it ships one
 *     (multi-page sites do), else index.html with 200 (single-page apps route
 *     on the client, so every unknown path must load the app shell).
 */

import * as fs from 'fs';
import * as nodePath from 'path';
import { Readable } from 'stream';
import { NextResponse } from 'next/server';

export function getMimeType(filePath: string): string {
  const ext = nodePath.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.mjs':  'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg':  'image/svg+xml',
    '.png':  'image/png',
    '.jpg':  'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif':  'image/gif',  '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.ico':  'image/x-icon',
    '.woff': 'font/woff',  '.woff2': 'font/woff2',
    '.ttf':  'font/ttf',
    '.txt':  'text/plain; charset=utf-8',
    '.xml':  'application/xml; charset=utf-8',
    '.pdf':  'application/pdf',
    '.mp4':  'video/mp4',  '.webm': 'video/webm',
    '.map':  'application/json',
    '.webmanifest': 'application/manifest+json',
  };
  return map[ext] ?? 'application/octet-stream';
}

/**
 * Rewrites absolute-path asset references in HTML so they resolve through the
 * in-app proxy instead of hitting the Next.js root.
 *
 * Vite and other bundlers emit paths like src="/assets/index.js" which are
 * correct when the site owns the root, but break when served under a sub-path
 * such as /api/proxy/{slug}/. This rewrites those paths at serve time so the
 * browser fetches /api/proxy/{slug}/assets/index.js.
 *
 * A <base> tag is also injected so that dynamic imports and runtime-constructed
 * relative URLs resolve against the proxy base.
 */
export function rewriteHtmlPaths(html: string, slug: string): string {
  const prefix = `/api/proxy/${slug}`;
  const withBase = html.replace(/(<head\b[^>]*>)/i, `$1\n  <base href="${prefix}/">`);
  return withBase.replace(
    /(src|href|action)="(\/[^"]*?)"/g,
    (match, attr: string, path: string) => {
      if (path.startsWith('//') || path.startsWith('/api/proxy/')) return match;
      return `${attr}="${prefix}${path}"`;
    }
  );
}

/**
 * True for paths through a dot-file or dot-directory (`/.git/config`,
 * `/.env`, `/.npmrc`), which a static site must never serve even if they were
 * uploaded. `/.well-known/` is the one standard exception.
 */
export function isHiddenPath(requestPath: string): boolean {
  return requestPath
    .split('/')
    .some((segment) => segment.startsWith('.') && segment !== '.well-known');
}

/** Whether the last path segment has an extension, i.e. names a file rather than a route. */
function looksLikeAsset(requestPath: string): boolean {
  const last = requestPath.split('/').pop() ?? '';
  return nodePath.extname(last) !== '';
}

function notFound(): NextResponse {
  return new NextResponse('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

/** Weak validator from size and mtime — cheap, and changes on every redeploy. */
function etagFor(stat: fs.Stats): string {
  return `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
}

/** Resolves `rel` under `serveDir`, or null if it would escape it. */
function inside(serveDir: string, rel: string): string | null {
  const base = nodePath.resolve(serveDir);
  const full = nodePath.resolve(base, rel);
  return full === base || full.startsWith(base + nodePath.sep) ? full : null;
}

async function statFile(filePath: string | null): Promise<fs.Stats | null> {
  if (!filePath) return null;
  try {
    const stat = await fs.promises.stat(filePath);
    return stat.isFile() ? stat : null;
  } catch {
    return null;
  }
}

async function respondWithFile(
  filePath: string,
  stat: fs.Stats,
  opts: { slug?: string; ifNoneMatch?: string | null; status?: number },
): Promise<NextResponse> {
  const status = opts.status ?? 200;
  const mime = getMimeType(filePath);
  const isHtml = mime.startsWith('text/html');
  const isHashed = filePath.includes(`${nodePath.sep}assets${nodePath.sep}`)
    || filePath.includes(`${nodePath.sep}_next${nodePath.sep}static${nodePath.sep}`);
  const headers: Record<string, string> = {
    'Content-Type': mime,
    'Cache-Control': isHashed ? 'public, max-age=31536000, immutable' : isHtml ? 'no-cache' : 'public, max-age=3600',
  };

  // HTML rewritten for local dev has a different body, so no validator for it.
  const rewrite = isHtml && !!opts.slug;
  if (status === 200 && !rewrite) {
    const etag = etagFor(stat);
    headers.ETag = etag;
    if (opts.ifNoneMatch && opts.ifNoneMatch.split(',').map((t) => t.trim()).includes(etag)) {
      return new NextResponse(null, { status: 304, headers });
    }
  }

  if (rewrite) {
    const html = rewriteHtmlPaths(await fs.promises.readFile(filePath, 'utf-8'), opts.slug!);
    return new NextResponse(html, { status, headers });
  }

  // Stream rather than buffer: one large video or archive per request would
  // otherwise sit whole in the memory of the process serving every site.
  headers['Content-Length'] = String(stat.size);
  const body = Readable.toWeb(fs.createReadStream(filePath)) as ReadableStream<Uint8Array>;
  return new NextResponse(body, { status, headers });
}

export async function serveStaticFile(
  serveDir: string,
  requestPath: string,
  opts: { slug?: string; ifNoneMatch?: string | null } = {},
): Promise<NextResponse | null> {
  if (isHiddenPath(requestPath)) return notFound();

  const rel = requestPath.replace(/^\/+/, '').replace(/\/+$/, '');
  const candidates = rel
    ? [rel, `${rel}.html`, nodePath.join(rel, 'index.html')]
    : ['index.html'];

  for (const candidate of candidates) {
    const filePath = inside(serveDir, candidate);
    const stat = await statFile(filePath);
    if (filePath && stat) return respondWithFile(filePath, stat, opts);
  }

  if (looksLikeAsset(requestPath)) return notFound();

  const custom404 = inside(serveDir, '404.html')!;
  const custom404Stat = await statFile(custom404);
  if (custom404Stat) return respondWithFile(custom404, custom404Stat, { ...opts, status: 404 });

  // Single-page app fallback.
  const index = inside(serveDir, 'index.html')!;
  const indexStat = await statFile(index);
  return indexStat ? respondWithFile(index, indexStat, opts) : null;
}
