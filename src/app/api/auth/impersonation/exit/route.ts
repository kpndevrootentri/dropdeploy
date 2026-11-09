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
 * Deliberately not behind getSession: it is the one write allowed while viewing,
 * and it must still work after the 30-minute view has expired.
 */
export async function POST(req: NextRequest): Promise<NextResponse<unknown>> {
  const restoreToken = getAdminRestoreToken(req);
  if (!restoreToken) return signedOut('No admin session to return to. Sign in again.');

  try {
    // A genuine, unrevoked admin session — not just any signed token.
    const admin = await authService.verifySession(restoreToken);
    if (admin.role !== 'CONTRIBUTOR' || admin.impersonatorId) return signedOut('Sign in again.');

    // A tenant site can plant cookies on the parent domain. If the current view is
    // still valid it must belong to this admin, so a planted restore cookie cannot
    // swap anyone into a different account.
    const current = getTokenFromCookie(req);
    const viewing = current ? await authService.verifyToken(current).catch(() => null) : null;
    if (viewing && viewing.impersonatorId !== admin.userId) return signedOut('Sign in again.');

    const { exp } = await authService.verifyToken(restoreToken);
    await prisma.platformEvent.create({
      data: {
        event: 'admin.impersonate.exit',
        userId: admin.userId,
        meta: { targetId: viewing?.sub ?? null, targetEmail: viewing?.email ?? null },
      },
    });

    const res = NextResponse.json({ success: true });
    setAuthCookie(res, restoreToken, Math.max(0, exp - Math.floor(Date.now() / 1000)));
    clearAdminRestoreCookie(res);
    return res;
  } catch {
    return signedOut('Your admin session has ended. Sign in again.');
  }
}
