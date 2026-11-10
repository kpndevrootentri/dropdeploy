import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { adminService } from '@/services/admin';
import { handleApiError } from '@/lib/api-error';
import { invitePath } from '@/services/invite';

/**
 * POST /api/admin/users/[userId]/invite – issue a new one-time invite link for
 * a user who has not chosen a password yet (contributor only). Earlier unused
 * links stop working; the new one is returned once and cannot be fetched again.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    const { userId } = await params;
    const token = await adminService.reissueInvite(userId);
    return NextResponse.json({ success: true, data: { invitePath: invitePath(token) } }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleApiError(error);
  }
}
