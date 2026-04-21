import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { getTokenFromCookie, AUTH_COOKIE_NAME } from '@/lib/auth-cookie';
import { authService } from '@/services/auth';
import { UnauthorizedError } from '@/lib/errors';

export interface Session {
  userId: string;
  email: string;
  role: string;
  mustResetPassword: boolean;
}

/**
 * Returns the current user session from the request cookie.
 * Throws UnauthorizedError if not logged in or token invalid.
 */
export async function getSession(req: NextRequest): Promise<Session> {
  const token = getTokenFromCookie(req);
  if (!token) {
    throw new UnauthorizedError('Not authenticated');
  }
  const payload = await authService.verifyToken(token);
  return {
    userId: payload.sub,
    email: payload.email,
    role: payload.role ?? 'USER',
    mustResetPassword: payload.mustResetPassword ?? false,
  };
}

/**
 * Returns the session from Next.js server component cookies (no NextRequest needed).
 * Returns null if not logged in or token invalid — never throws.
 */
export async function getSessionFromCookies(): Promise<Session | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
    if (!token) return null;
    const payload = await authService.verifyToken(token);
    return {
      userId: payload.sub,
      email: payload.email,
      role: payload.role ?? 'USER',
      mustResetPassword: payload.mustResetPassword ?? false,
    };
  } catch {
    return null;
  }
}
