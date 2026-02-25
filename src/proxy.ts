import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as jose from 'jose';
import { randomUUID } from 'crypto';
import { getTokenFromCookie } from '@/lib/auth-cookie';

const DASHBOARD_PREFIX = '/dashboard';
const ADMIN_PREFIX = '/dashboard/admin';
const AUTH_PAGES = ['/login'];
const RESET_PASSWORD_PATH = '/reset-password';

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function withRequestId(req: NextRequest, response: NextResponse): NextResponse {
  const requestId = req.headers.get('x-request-id') ?? randomUUID();
  response.headers.set('x-request-id', requestId);
  return response;
}

/**
 * Top-level Next.js proxy (replaces middleware.ts in Next.js 16+).
 *
 * Two responsibilities:
 *  1. Subdomain proxy: requests arriving at {slug}.BASE_DOMAIN are internally
 *     rewritten to /api/proxy/{slug}/{...path} so the in-app proxy handler can
 *     look up the container port and forward the request.
 *  2. Auth/dashboard guard: all other requests go through JWT verification,
 *     redirect rules, and request-ID injection.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const hostname = request.headers.get('host') ?? '';
  const baseDomain = process.env.BASE_DOMAIN ?? '';

  // Match {slug}.{BASE_DOMAIN} (with optional :port for local dev)
  const subdomainPattern = new RegExp(
    `^([a-z0-9][a-z0-9-]*)\\.${escapeRegex(baseDomain)}(?::\\d+)?$`
  );
  const match = hostname.match(subdomainPattern);

  if (match) {
    const slug = match[1];
    const url = request.nextUrl.clone();
    const originalPath = url.pathname;
    // Rewrite to internal proxy route while preserving query string
    url.pathname = `/api/proxy/${slug}${originalPath === '/' ? '' : originalPath}`;
    return NextResponse.rewrite(url);
  }

  // Non-subdomain request — auth/dashboard guard
  const { pathname } = request.nextUrl;

  // For API routes: inject request ID and pass through (no auth redirect needed here)
  if (pathname.startsWith('/api/')) {
    const requestId = request.headers.get('x-request-id') ?? randomUUID();
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-request-id', requestId);
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set('x-request-id', requestId);
    return response;
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
  // Run on all paths except Next.js internals and static assets
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico).*)'],
};
