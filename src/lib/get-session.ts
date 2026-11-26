import { NextRequest } from 'next/server';
import { headers } from 'next/headers';
import { getTokenFromCookie, getTokenFromCookieHeader } from '@/lib/auth-cookie';
import { authService } from '@/services/auth';
import { API_TOKEN_PREFIX, apiTokenService } from '@/services/api-token';
import { ForbiddenError, UnauthorizedError } from '@/lib/errors';
import { impersonationBlockReason } from '@/lib/impersonation';
import { apiTokenBlockReason } from '@/lib/api-token-scope';

export interface Session {
  userId: string;
  email: string;
  role: string;
  mustResetPassword: boolean;
  /** Set while an admin views as this user. Every API request passes here, so this is where viewing is kept read-only. */
  impersonatorId?: string;
  /** The auth cookie, a login JWT sent as Bearer (the CLI), or an `ent_` API token sent as Bearer. */
  via: 'cookie' | 'jwt' | 'api-token';
  /** Set only when `via` is 'api-token'. */
  tokenScope?: 'DEPLOY' | 'FULL';
}

/**
 * Returns the current user session from the request cookie or Bearer token.
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
  const cookieToken = getTokenFromCookie(req);
  let session: Session;
  // The cookie wins over any Bearer header, as before, so a browser session never becomes a token session.
  if (!cookieToken && bearerToken?.startsWith(API_TOKEN_PREFIX)) {
    session = await apiTokenSession(req, bearerToken);
  } else {
    const token = cookieToken ?? bearerToken;
    if (!token) {
      throw new UnauthorizedError('Not authenticated');
    }
    session = { ...(await authService.verifySession(token)), via: cookieToken ? 'cookie' : 'jwt' };
    if (session.impersonatorId) {
      // Only writes are refused by method. A new GET with side effects, or one that uses the user's
      // provider token, must be added to CLOSED_WHILE_VIEWING in lib/impersonation.ts.
      const blocked = impersonationBlockReason(req.method, req.nextUrl.pathname);
      if (blocked) throw new ForbiddenError(blocked);
    }
  }
  if (session.mustResetPassword && !opts.allowPendingPasswordReset) {
    throw new ForbiddenError('Set a new password before continuing');
  }
  return session;
}

/** A session from an `ent_` API token, limited to what its scope allows (lib/api-token-scope.ts). */
async function apiTokenSession(req: NextRequest, token: string): Promise<Session> {
  const found = await apiTokenService.verify(token);
  if (!found) throw new UnauthorizedError('Invalid or expired API token');
  const blocked = apiTokenBlockReason(found.token.scope, req.method, req.nextUrl.pathname);
  if (blocked) throw new ForbiddenError(blocked);
  const { user } = found;
  return {
    userId: user.id,
    email: user.email,
    role: user.role,
    mustResetPassword: user.mustResetPassword,
    via: 'api-token',
    tokenScope: found.token.scope,
  };
}

/**
 * Returns the session from Next.js server component cookies (no NextRequest needed).
 * Returns null if not logged in or token invalid — never throws.
 */
export async function getSessionFromCookies(): Promise<Session | null> {
  try {
    const token = getTokenFromCookieHeader((await headers()).get('cookie'));
    if (!token) return null;
    return { ...(await authService.verifySession(token)), via: 'cookie' };
  } catch {
    return null;
  }
}
