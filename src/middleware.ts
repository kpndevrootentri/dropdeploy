import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as jose from 'jose';
import { getTokenFromCookie } from '@/lib/auth-cookie';

const DASHBOARD_PREFIX = '/dashboard';
const ADMIN_PREFIX = '/dashboard/admin';
const AUTH_PAGES = ['/login'];
const RESET_PASSWORD_PATH = '/reset-password';

/**
 * Protects /dashboard when no valid JWT; redirects logged-in users from /login, /register.
 * Forces users with mustResetPassword to /reset-password before accessing the dashboard.
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
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
    return NextResponse.redirect(new URL(RESET_PASSWORD_PATH, request.url));
  }

  // Prevent normal users (no reset needed) from visiting /reset-password
  if (isAuthenticated && !mustResetPassword && pathname === RESET_PASSWORD_PATH) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  if (pathname.startsWith(DASHBOARD_PREFIX) && !isAuthenticated) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (pathname.startsWith(ADMIN_PREFIX) && isAuthenticated && userRole !== 'CONTRIBUTOR') {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  if (AUTH_PAGES.some((p) => pathname === p) && isAuthenticated) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/login', '/reset-password'],
};
