import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { authService, IMPERSONATION_TTL_SECONDS } from '@/services/auth';
import { handleApiError } from '@/lib/api-error';
import { ValidationError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { getTokenFromCookie, setAuthCookie, setAdminRestoreCookie } from '@/lib/auth-cookie';

/**
 * POST /api/admin/users/[userId]/impersonate – view the dashboard as this user, read-only, for 30 minutes (contributor only).
 * The admin's own session is kept aside in a host-only cookie that only the exit route receives.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    // A CLI bearer token has no browser session to return to.
    const adminToken = getTokenFromCookie(req);
    if (!adminToken) throw new ValidationError('View as user works from the dashboard only');

    const { userId } = await params;
    const { accessToken, target } = await authService.impersonate(session.userId, userId);
    const { exp } = await authService.verifyToken(adminToken);

    // Interim audit record until the AdminAction log lands. Awaited: no record, no view.
    await prisma.platformEvent.create({
      data: {
        event: 'admin.impersonate.start',
        userId: session.userId,
        meta: { targetId: target.id, targetEmail: target.email },
      },
    });

    const res = NextResponse.json({ success: true });
    setAdminRestoreCookie(res, adminToken, Math.max(0, exp - Math.floor(Date.now() / 1000)));
    setAuthCookie(res, accessToken, IMPERSONATION_TTL_SECONDS);
    return res;
  } catch (error) {
    return handleApiError(error);
  }
}
