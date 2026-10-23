import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import * as nodePath from 'path';
import { serveStaticFile } from '@/lib/static-serve';
import { getTokenFromCookie, isAuthSetCookie, withoutAuthCookie } from '@/lib/auth-cookie';
import { getConfig } from '@/lib/config';
import { mayServeTenant } from '@/lib/platform-host';
import { publicLocation } from '@/lib/upstream-location';
import { projectAccessService } from '@/services/project-access';
import { authService } from '@/services/auth';

export const dynamic = 'force-dynamic';

function detectDevice(ua: string): 'mobile' | 'desktop' | 'bot' | 'unknown' {
  if (!ua) return 'unknown';
  const l = ua.toLowerCase();
  if (
    l.includes('bot') || l.includes('crawler') || l.includes('spider') ||
    l.includes('slurp') || l.includes('googlebot') || l.includes('facebookexternalhit')
  ) return 'bot';
  if (l.includes('mobile') || l.includes('android') || l.includes('iphone') || l.includes('ipad'))
    return 'mobile';
  return 'desktop';
}

/**
 * Hop-by-hop headers that must not be forwarded between proxies per RFC 7230.
 */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
]);

/**
 * Headers to strip from the upstream response.
 * Node.js fetch automatically decompresses gzip/br/deflate responses, so
 * forwarding content-encoding would tell the browser to decompress an already
 * decompressed body — causing a "Content Encoding Error". content-length is
 * also stale after decompression and must be dropped.
 */
const STRIP_RESPONSE = new Set(['content-encoding', 'content-length']);

/** Longest wait for a deployed app to send response headers. */
const UPSTREAM_HEADERS_TIMEOUT_MS = 60_000;

/**
 * Returns a 3D isometric HTML denial page for private URLs.
 */
function denialResponse(): NextResponse {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>401 Access Denied</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: #060608;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    overflow: hidden;
    gap: 40px;
  }

  /* Ambient orbs */
  .orb {
    position: fixed;
    border-radius: 50%;
    filter: blur(100px);
    pointer-events: none;
    z-index: 0;
  }
  .orb-1 {
    width: 560px; height: 560px;
    background: radial-gradient(circle, rgba(124,58,237,0.28), transparent 70%);
    top: -180px; left: -120px;
    animation: d1 16s ease-in-out infinite alternate;
  }
  .orb-2 {
    width: 480px; height: 480px;
    background: radial-gradient(circle, rgba(219,39,119,0.2), transparent 70%);
    bottom: -140px; right: -100px;
    animation: d2 20s ease-in-out infinite alternate;
  }
  .orb-3 {
    width: 360px; height: 360px;
    background: radial-gradient(circle, rgba(14,165,233,0.14), transparent 70%);
    top: 50%; left: 50%;
    transform: translate(-50%,-50%);
    animation: d3 13s ease-in-out infinite alternate;
  }
  @keyframes d1 { to { transform: translate(50px, 35px); } }
  @keyframes d2 { to { transform: translate(-35px, -50px); } }
  @keyframes d3 { to { transform: translate(-50%,-52%) scale(1.15); } }

  /* Digits row */
  .digits {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    gap: 8px;
  }

  /* Each digit: isometric 3D block letter via perspective tilt + layered text-shadow extrusion */
  .d {
    display: inline-block;
    font-size: 148px;
    font-weight: 900;
    line-height: 1;
    letter-spacing: -2px;
    color: #ddd6fe;
    /* Isometric camera angle */
    transform: perspective(380px) rotateX(22deg) rotateY(-14deg) translateY(0);
    /* Extrusion depth: 12 shadow layers stepping down-right */
    text-shadow:
      2px  3px 0 #a78bfa,
      4px  6px 0 #9333ea,
      6px  9px 0 #7c3aed,
      8px  12px 0 #6d28d9,
      10px 15px 0 #5b21b6,
      12px 18px 0 #4c1d95,
      14px 21px 0 #3b0764,
      16px 23px 0 rgba(20,5,50,0.7),
      18px 25px 0 rgba(10,2,28,0.4);
    filter: drop-shadow(0 28px 48px rgba(109,40,217,0.45));
    animation: bob 5s ease-in-out infinite;
  }

  /* Stagger each digit's bob */
  .d:nth-child(1) { animation-delay:  0s; }
  .d:nth-child(2) { animation-delay: -1.8s; }
  .d:nth-child(3) { animation-delay: -3.4s; }

  @keyframes bob {
    0%,100% { transform: perspective(380px) rotateX(22deg) rotateY(-14deg) translateY(0px); }
    50%      { transform: perspective(380px) rotateX(22deg) rotateY(-14deg) translateY(-14px); }
  }

  /* Text below */
  .label {
    position: relative;
    z-index: 1;
    text-align: center;
  }
  .label h2 {
    font-size: 21px;
    font-weight: 600;
    color: #e2e8f0;
    letter-spacing: -0.2px;
    margin-bottom: 10px;
  }
  .divider {
    width: 44px; height: 2px;
    margin: 0 auto 12px;
    border-radius: 2px;
    background: linear-gradient(90deg, #7c3aed, #db2777);
  }
  .label p {
    font-size: 14px;
    color: #475569;
    line-height: 1.6;
  }
</style>
</head>
<body>
  <div class="orb orb-1"></div>
  <div class="orb orb-2"></div>
  <div class="orb orb-3"></div>

  <div class="digits">
    <span class="d">4</span>
    <span class="d">0</span>
    <span class="d">1</span>
  </div>

  <div class="label">
    <h2>Access Denied</h2>
    <div class="divider"></div>
    <p>You don't have permission to view this page.</p>
  </div>
</body>
</html>`;

  return new NextResponse(html, {
    status: 401,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

/**
 * In-app reverse proxy for deployed containers.
 *
 * Reached via the middleware rewrite:
 *   {slug}.domain.in/some/path  →  /api/proxy/{slug}/some/path
 *
 * Flow:
 *  1. Look up the active (DEPLOYED) deployment for the slug.
 *  2. If the project is private, verify the auth cookie carries an @entri.me JWT.
 *  3. Forward the HTTP request to http://127.0.0.1:{containerPort}/{path}.
 *  4. Stream the upstream response back to the client.
 *
 * No nginx config file is written or reloaded on deployment — routing is
 * resolved dynamically from the database on each request.
 */
async function handler(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; path?: string[] }> }
): Promise<NextResponse> {
  const { slug, path = [] } = await params;

  // Tenant content must never be served on a platform origin — on the
  // dashboard host it would run with the viewer's dashboard session. Checked
  // here, where the content is served, so no path that skips or out-parses
  // the rewrite in src/proxy.ts can reach it.
  const { BASE_DOMAIN, NODE_ENV } = getConfig();
  if (!mayServeTenant(request.headers.get('host') ?? '', slug, BASE_DOMAIN, NODE_ENV === 'production')) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Resolve active deployment port from DB, including project privacy flag
  const deployment = await prisma.deployment.findFirst({
    where: { subdomain: slug, status: 'DEPLOYED' },
    select: {
      containerPort: true,
      servingMethod: true,
      projectId: true,
      project: { select: { id: true, isPrivate: true, userId: true } },
    },
  });

  if (!deployment) {
    return NextResponse.json(
      { error: `No active deployment found for "${slug}"` },
      { status: 404 }
    );
  }

  // ── Private URL gate ─────────────────────────────────────────────────────
  // Authorize the project owner, anyone on the per-project access list (specific
  // user or allowed email domain), and platform admins (CONTRIBUTOR). A logged-in
  // user who is none of these is denied — being authenticated is not enough.
  if (deployment.project.isPrivate) {
    const token = getTokenFromCookie(request);
    let authorized = false;

    if (token) {
      try {
        // verifySession, not a bare JWT check: a revoked session or a removed
        // collaborator must lose access now, not when the token expires.
        const user = await authService.verifySession(token);
        authorized = await projectAccessService.canView(
          { id: deployment.project.id, userId: deployment.project.userId },
          { userId: user.userId, email: user.email, role: user.role },
        );
      } catch {
        // Expired, tampered or revoked token — treat as unauthenticated
      }
    }

    if (!authorized) {
      return denialResponse();
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  // Catch-all params drop a trailing slash; Django/WordPress routes depend on it.
  const trailingSlash = request.nextUrl.pathname.endsWith('/') ? '/' : '';
  const targetPath = path.length > 0 ? `/${path.join('/')}${trailingSlash}` : '/';

  if (deployment.servingMethod === 'STATIC_FILES') {
    const { STATIC_SERVE_DIR, NEXT_PUBLIC_APP_URL } = getConfig();
    const serveDir = nodePath.join(STATIC_SERVE_DIR, slug);
    // Path rewriting is only needed in localhost dev where the site is served under
    // /api/proxy/{slug}/. In production the site owns its own subdomain so absolute
    // paths (/_next/static/...) resolve correctly without any rewriting.
    const isLocalDev = NODE_ENV !== 'production' && !!NEXT_PUBLIC_APP_URL?.includes('localhost');
    const response = await serveStaticFile(serveDir, targetPath, {
      slug: isLocalDev ? slug : undefined,
      ifNoneMatch: request.headers.get('if-none-match'),
    });
    if (!response) {
      return NextResponse.json(
        { error: 'Static files not found. Try redeploying.' },
        { status: 404 }
      );
    }
    if (!targetPath.startsWith('/_next') && targetPath !== '/favicon.ico') {
      prisma.proxyHit.create({
        data: {
          projectId: deployment.projectId,
          path: targetPath,
          referer: request.headers.get('referer') ?? null,
          device: detectDevice(request.headers.get('user-agent') ?? ''),
        },
      }).catch(() => {});
    }
    return response;
  }

  if (!deployment.containerPort) {
    return NextResponse.json(
      { error: `No active deployment found for "${slug}"` },
      { status: 404 }
    );
  }

  const targetUrl = `http://127.0.0.1:${deployment.containerPort}${targetPath}${request.nextUrl.search}`;

  // Build forwarded headers — strip hop-by-hop, host and accept-encoding.
  // Cookies are forwarded so apps can keep their own sessions, minus the
  // platform's auth-token: that is the visitor's DropDeploy session and must
  // never reach tenant code.
  const forwardHeaders = new Headers();
  for (const [key, value] of request.headers.entries()) {
    const k = key.toLowerCase();
    if (!HOP_BY_HOP.has(k) && k !== 'host' && k !== 'accept-encoding' && k !== 'cookie') {
      forwardHeaders.set(key, value);
    }
  }
  const appCookies = withoutAuthCookie(request.headers.get('cookie'));
  if (appCookies) forwardHeaders.set('cookie', appCookies);
  const publicHost = request.headers.get('host') ?? '';
  const publicProto = request.nextUrl.protocol.replace(':', '');
  forwardHeaders.set('x-forwarded-host', publicHost);
  forwardHeaders.set('x-forwarded-proto', publicProto);

  const hasBody = !['GET', 'HEAD'].includes(request.method);

  // Bound the wait for the app to *start* responding, so a hung app cannot
  // pin proxy connections forever. Cleared once headers arrive: streamed
  // bodies (SSE, large downloads) may legitimately run much longer. The
  // client's own disconnect also aborts the upstream request.
  const headersTimeout = new AbortController();
  const timer = setTimeout(() => headersTimeout.abort(), UPSTREAM_HEADERS_TIMEOUT_MS);

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, {
      method: request.method,
      headers: forwardHeaders,
      body: hasBody ? request.body : undefined,
      signal: AbortSignal.any([request.signal, headersTimeout.signal]),
      // Relay redirects to the browser instead of following them here: a
      // followed redirect loses its Set-Cookie (login flows) and leaves the
      // browser on the old URL.
      redirect: 'manual',
      // duplex is required by Node.js fetch when body is a ReadableStream
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(hasBody && ({ duplex: 'half' } as any)),
    });
  } catch {
    if (headersTimeout.signal.aborted) {
      return NextResponse.json(
        { error: `The deployed app did not respond within ${UPSTREAM_HEADERS_TIMEOUT_MS / 1000}s.` },
        { status: 504 }
      );
    }
    return NextResponse.json(
      { error: 'Failed to reach the deployed app. It may still be starting up.' },
      { status: 502 }
    );
  } finally {
    clearTimeout(timer);
  }

  // Forward response headers, filtering hop-by-hop and decompression artifacts
  const responseHeaders = new Headers();
  for (const [key, value] of upstream.headers.entries()) {
    const k = key.toLowerCase();
    if (!HOP_BY_HOP.has(k) && !STRIP_RESPONSE.has(k) && k !== 'set-cookie') {
      responseHeaders.set(key, value);
    }
  }
  // Set-Cookie is the one header that may legitimately repeat, so it is
  // appended one by one — `set` above would keep only the last. The platform's
  // own auth cookie is dropped: see isAuthSetCookie.
  for (const cookie of upstream.headers.getSetCookie()) {
    if (!isAuthSetCookie(cookie)) responseHeaders.append('set-cookie', cookie);
  }
  const location = upstream.headers.get('location');
  if (location && publicHost) {
    responseHeaders.set(
      'location',
      publicLocation(location, deployment.containerPort, `${publicProto}://${publicHost}`),
    );
  }

  // Record hit async — skip internal Next.js asset paths
  if (!targetPath.startsWith('/_next') && targetPath !== '/favicon.ico') {
    prisma.proxyHit.create({
      data: {
        projectId: deployment.projectId,
        path: targetPath,
        referer: request.headers.get('referer') ?? null,
        device: detectDevice(request.headers.get('user-agent') ?? ''),
      },
    }).catch(() => {});
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const HEAD = handler;
export const OPTIONS = handler;
