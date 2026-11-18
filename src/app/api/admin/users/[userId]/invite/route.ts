import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { adminService } from '@/services/admin';
import { handleApiError } from '@/lib/api-error';
import { invitePath, inviteService } from '@/services/invite';

/**
 * POST /api/admin/users/[userId]/invite – issue a new one-time password link and
 * email it (contributor only): an invite if the user has not chosen a password
 * yet, otherwise a reset link. Earlier unused links stop working; the new one is
 * also returned once, as a fallback for when the email does not arrive.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    const { userId } = await params;
    const { token, email, kind } = await adminService.issuePasswordLink(userId, session.userId);
    const emailed = await inviteService.sendLink(email, token, kind);
    return NextResponse.json(
      { success: true, data: { invitePath: invitePath(token), kind, emailed } },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
