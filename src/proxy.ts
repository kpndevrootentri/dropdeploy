import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as jose from 'jose';
import { randomUUID } from 'crypto';
import { getTokenFromCookie } from '@/lib/auth-cookie';
import { isPlatformHost, matchTenantSubdomain } from '@/lib/platform-host';
import { isForeignOriginMutation } from '@/lib/csrf';
import { isRoutableStatus } from '@/lib/domain-status';

const DASHBOARD_PREFIX = '/dashboard';
/** Left to the TLS-terminating edge, which answers HTTP-01 challenges itself. */
const ACME_CHALLENGE_PREFIX = '/.well-known/acme-challenge/';
const ADMIN_PREFIX = '/dashboard/admin';
const AUTH_PAGES = ['/login'];
const RESET_PASSWORD_PATH = '/reset-password';

/**
 * Matches `envBool` in `src/lib/config.ts`. The proxy reads `process.env`
 * directly rather than `getConfig()` so that the middleware bundle stays free
 * of Zod and of the throw-on-invalid-env behaviour, which would take down every
 * request rather than one route.
 */
function envFlag(value: string | undefined): boolean {
  return value !== undefined && ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

/** Rewrites the current request into the in-app proxy route for `slug`. */
function rewriteToProxy(request: NextRequest, slug: string): NextResponse {
  const url = request.nextUrl.clone();
  const originalPath = url.pathname;
  url.pathname = `/api/proxy/${slug}${originalPath === '/' ? '' : originalPath}`;
  return NextResponse.rewrite(url);
}

/**
 * Headers for everything the platform itself serves (never tenant sites,
 * which are rewritten before this point and set their own).
 *
 * The dashboard must not be framable: a page on any other site could
 * otherwise overlay it invisibly and steer a signed-in user's clicks onto
 * "Delete project", the terminal, or an admin action.
 */
function withPlatformHeaders(response: NextResponse): NextResponse {
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Content-Security-Policy', "frame-ancestors 'none'");
  return response;
}

function withRequestId(req: NextRequest, response: NextResponse): NextResponse {
  const requestId = req.headers.get('x-request-id') ?? randomUUID();
  response.headers.set('x-request-id', requestId);
  return withPlatformHeaders(response);
}

/**
 * Top-level Next.js proxy (replaces middleware.ts in Next.js 16+).
 *
 * Three responsibilities, resolved in this order:
 *  1. Subdomain proxy: requests arriving at {slug}.BASE_DOMAIN are internally
 *     rewritten to /api/proxy/{slug}/{...path} so the in-app proxy handler can
 *     look up the container port and forward the request.
 *  2. Custom domains: any other non-platform host is resolved (through a cache)
 *     to the project that owns it and rewritten to the same proxy route.
 *  3. Auth/dashboard guard: platform hosts go through JWT verification,
 *     redirect rules, and request-ID injection.
 *
 * This is the single authoritative routing layer. nginx/Caddy in front of it
 * terminate TLS and pass through with the original Host header intact; they do
 * not route to containers themselves. Any edge that proxied a subdomain
 * straight to a container would bypass the private-URL gate and the ProxyHit
 * analytics that live in the proxy route.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const hostname = request.headers.get('host') ?? '';
  const baseDomain = process.env.BASE_DOMAIN ?? '';

  // Match {slug}.{BASE_DOMAIN} (with optional :port for local dev)
  const subdomainSlug = matchTenantSubdomain(hostname, baseDomain);

  if (subdomainSlug) {
    // Rewrite to internal proxy route while preserving query string
    return rewriteToProxy(request, subdomainSlug);
  }

  const { pathname } = request.nextUrl;

  // ── Custom domains ───────────────────────────────────────────────────────
  // Resolution order is deliberate: the *.BASE_DOMAIN regex above is a free
  // string match and runs first; only a host that misses it — and is not one of
  // the platform's own hosts — costs a (cached) lookup. Everything else falls
  // through to the auth guard exactly as before, so this branch cannot affect
  // any existing deployment. The dynamic import defers the resolver's module
  // *initialisation* (Prisma/Redis connections) off that common path; it is not
  // a bundle-size optimisation.
  //
  // The rewrite target is identical to the subdomain path, which is the whole
  // point: the proxy route re-resolves the deployment, re-applies the private
  // URL gate and records the ProxyHit from the database on every request. A
  // custom domain therefore inherits all of that unchanged — it cannot become
  // a way around the privacy gate.
  if (
    envFlag(process.env.CUSTOM_DOMAINS_ENABLED) &&
    !pathname.startsWith(ACME_CHALLENGE_PREFIX) &&
    !isPlatformHost(hostname, baseDomain)
  ) {
    const { resolveHostRoute, promoteHostToActive } = await import('@/lib/domain-resolver');
    const route = await resolveHostRoute(hostname);

    if (route && isRoutableStatus(route.status)) {
      // A non-primary alias 301s to the primary so a project has one canonical
      // origin. Only ever redirect to a host that is actually serving.
      if (
        !route.isPrimary &&
        route.redirectToPrimary &&
        route.primaryHostname &&
        route.primaryHostname !== route.hostname
      ) {
        const target = request.nextUrl.clone();
        target.hostname = route.primaryHostname;
        target.port = '';
        target.protocol = 'https:';
        return NextResponse.redirect(target, 301);
      }

      // A real HTTPS request is the first trustworthy evidence that the edge
      // holds a certificate for this host — the ask endpoint fires before
      // issuance, so it cannot tell us this. Fire-and-forget; the cache eviction
      // inside means this runs about once per cache TTL, not once per request.
      if (
        route.status !== 'ACTIVE' &&
        (request.headers.get('x-forwarded-proto') ?? request.nextUrl.protocol.replace(':', '')) === 'https'
      ) {
        void promoteHostToActive(route.hostname);
      }

      return rewriteToProxy(request, route.slug);
    }

    // Reached when the hostname is unknown, or is known but no longer proven.
    //
    // Unknown: it must not be served the dashboard — that would let anyone
    // front the login page from a domain they control.
    //
    // No longer proven (FAILED): the five-strikes teardown flipped it, but the
    // edge still holds a valid certificate and will keep serving TLS for it
    // until renewal, because it only consults the ask endpoint to *obtain* a
    // certificate, never to serve one it already has. This gate is what
    // actually stops us serving a domain we decided to stop serving.
    return new NextResponse('This domain is not configured on DropDeploy.', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  // Non-subdomain request — auth/dashboard guard

  // next.config.js skips Next's trailing-slash redirect so tenant paths pass
  // through intact; platform URLs keep the one canonical form it enforced.
  if (pathname !== '/' && pathname.endsWith('/')) {
    // A plain URL: NextURL re-appends the slash it was parsed with.
    const url = new URL(request.url);
    url.pathname = pathname.replace(/\/+$/, '') || '/';
    return NextResponse.redirect(url, 308);
  }

  // Static assets must never be redirected — the browser needs them to render any page,
  // including /reset-password. Without this, mustResetPassword users would receive an
  // HTML redirect instead of JS chunks, causing "Unexpected token '<'" errors.
  if (
    pathname.startsWith('/_next/static') ||
    pathname.startsWith('/_next/image') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next();
  }

  // For API routes: inject request ID and pass through (no auth redirect needed here)
  if (pathname.startsWith('/api/')) {
    if (
      isForeignOriginMutation(
        request.method,
        hostname,
        request.headers.get('origin'),
        request.headers.get('sec-fetch-site'),
      )
    ) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: 'Cross-origin request refused' } },
        { status: 403 },
      );
    }

    const requestId = request.headers.get('x-request-id') ?? randomUUID();
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-request-id', requestId);
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set('x-request-id', requestId);
    return withPlatformHeaders(response);
  }

  const token = getTokenFromCookie(request);

  let isAuthenticated = false;
  let userRole = 'USER';
  let mustResetPassword = false;

  if (token) {
    const secret = process.env.JWT_SECRET;
    if (secret) {
      try {
        const { payload } = await jose.jwtVerify(token, new TextEncoder().encode(secret), {
          algorithms: ['HS256'],
        });
        isAuthenticated = true;
        userRole = (payload.role as string) ?? 'USER';
        mustResetPassword = (payload.mustResetPassword as boolean) ?? false;
      } catch {
        // Invalid or expired token
      }
    }
  }

  // Force password reset: authenticated users with mustResetPassword must go to /reset-password
  if (isAuthenticated && mustResetPassword && pathname !== RESET_PASSWORD_PATH) {
    return withRequestId(request, NextResponse.redirect(new URL(RESET_PASSWORD_PATH, request.url)));
  }

  // Prevent normal users (no reset needed) from visiting /reset-password
  if (isAuthenticated && !mustResetPassword && pathname === RESET_PASSWORD_PATH) {
    return withRequestId(request, NextResponse.redirect(new URL('/dashboard', request.url)));
  }

  if (pathname.startsWith(DASHBOARD_PREFIX) && !isAuthenticated) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', pathname);
    return withRequestId(request, NextResponse.redirect(loginUrl));
  }

  if (pathname.startsWith(ADMIN_PREFIX) && isAuthenticated && userRole !== 'CONTRIBUTOR') {
    return withRequestId(request, NextResponse.redirect(new URL('/dashboard', request.url)));
  }

  if (AUTH_PAGES.some((p) => pathname === p) && isAuthenticated) {
    return withRequestId(request, NextResponse.redirect(new URL('/dashboard', request.url)));
  }

  return withRequestId(request, NextResponse.next());
}

export const config = {
  matcher: [
    /*
     * Run on ALL paths. We cannot exclude _next/static or _next/image here
     * because subdomain requests (e.g. nextjs.app.en3.wtf/_next/static/...)
     * must be rewritten to the container — skipping them would cause the
     * platform's own static files to be served instead of the deployed app's.
     *
     * For non-subdomain requests the auth guard falls through to
     * NextResponse.next() for static assets, so there is no functional
     * difference — just a tiny bit of extra middleware overhead on the
     * platform's own /_next/* paths.
     */
    '/(.*)',
  ],
};
