import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/services/auth';
import { prisma } from '@/lib/prisma';
import {
  getTokenFromCookie,
  getAdminRestoreToken,
  setAuthCookie,
  clearAuthCookie,
  clearAdminRestoreCookie,
} from '@/lib/auth-cookie';

/** Ends the view by signing out entirely; the admin signs in again. */
function signedOut(message: string): NextResponse {
  const res = NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message } }, { status: 401 });
  clearAuthCookie(res);
  clearAdminRestoreCookie(res);
  return res;
}

/**
 * POST /api/auth/impersonation/exit – stop viewing as a user and restore the admin's own session.
 * Deliberately not behind getSession: it is the one write allowed while viewing.
 */
export async function POST(req: NextRequest): Promise<NextResponse<unknown>> {
  const restoreToken = getAdminRestoreToken(req);
  if (!restoreToken) return signedOut('No admin session to return to. Sign in again.');

  try {
    // A genuine, unrevoked admin session — not just any signed token.
    const admin = await authService.verifySession(restoreToken);
    if (admin.role !== 'CONTRIBUTOR' || admin.impersonatorId) return signedOut('Sign in again.');

    // A tenant site can plant (and, by overflowing the cookie jar, evict) cookies
    // on the parent domain, but cannot plant the host-only session cookie. So the
    // restore cookie is only trusted for the live view of this same admin; once
    // the view has expired the admin signs in again.
    const current = getTokenFromCookie(req);
    const viewing = current ? await authService.verifyToken(current).catch(() => null) : null;
    if (viewing?.impersonatorId !== admin.userId) return signedOut('Sign in again.');

    const { exp } = await authService.verifyToken(restoreToken);
    await prisma.platformEvent.create({
      data: {
        event: 'admin.impersonate.exit',
        userId: admin.userId,
        meta: { targetId: viewing.sub, targetEmail: viewing.email },
      },
    });

    const res = NextResponse.json({ success: true });
    setAuthCookie(res, restoreToken, await authService.siteTokenFor(restoreToken), Math.max(0, exp - Math.floor(Date.now() / 1000)));
    clearAdminRestoreCookie(res);
    return res;
  } catch {
    return signedOut('Your admin session has ended. Sign in again.');
  }
}
