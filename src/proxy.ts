import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as jose from 'jose';
import { randomUUID } from 'crypto';
import { getTokenFromCookie } from '@/lib/auth-cookie';

const DASHBOARD_PREFIX = '/dashboard';
const ADMIN_PREFIX = '/dashboard/admin';
const AUTH_PAGES = ['/login'];
const RESET_PASSWORD_PATH = '/reset-password';

/**
 * Injects a unique x-request-id header into the request and echoes it in the
 * response so that log lines from the same HTTP request can be correlated.
 */
function withRequestId(req: NextRequest, response: NextResponse): NextResponse {
  const requestId = req.headers.get('x-request-id') ?? randomUUID();
  response.headers.set('x-request-id', requestId);
  return response;
}

/**
 * Protects /dashboard when no valid JWT; redirects logged-in users from /login.
 * Forces users with mustResetPassword to /reset-password before accessing the dashboard.
 * Also injects x-request-id on all API requests for structured log correlation.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
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
  matcher: ['/dashboard/:path*', '/login', '/reset-password', '/api/:path*'],
};
