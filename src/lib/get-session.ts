import { NextRequest } from 'next/server';
import { headers } from 'next/headers';
import { getTokenFromCookie, getTokenFromCookieHeader } from '@/lib/auth-cookie';
import { authService } from '@/services/auth';
import { ForbiddenError, UnauthorizedError } from '@/lib/errors';

export interface Session {
  userId: string;
  email: string;
  role: string;
  mustResetPassword: boolean;
}

/**
 * Returns the current user session from the request cookie.
 * Throws UnauthorizedError if not logged in or token invalid.
 *
 * A user whose password an admin reset must choose a new one before doing
 * anything else. The dashboard pages enforce that with a redirect; this makes
 * the API enforce it too, so the admin-known password cannot be used through
 * the API or the CLI. Only the password-change route opts out.
 */
export async function getSession(
  req: NextRequest,
  opts: { allowPendingPasswordReset?: boolean } = {},
): Promise<Session> {
  const bearerHeader = req.headers.get('authorization');
  const bearerToken = bearerHeader?.match(/^Bearer\s+(.+)$/i)?.[1];
  const token = getTokenFromCookie(req) ?? bearerToken;
  if (!token) {
    throw new UnauthorizedError('Not authenticated');
  }
  const session = await authService.verifySession(token);
  if (session.mustResetPassword && !opts.allowPendingPasswordReset) {
    throw new ForbiddenError('Set a new password before continuing');
  }
  return session;
}

/**
 * Returns the session from Next.js server component cookies (no NextRequest needed).
 * Returns null if not logged in or token invalid — never throws.
 */
export async function getSessionFromCookies(): Promise<Session | null> {
  try {
    const token = getTokenFromCookieHeader((await headers()).get('cookie'));
    if (!token) return null;
    return await authService.verifySession(token);
  } catch {
    return null;
  }
}
