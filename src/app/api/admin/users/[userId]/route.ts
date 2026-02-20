import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { adminService } from '@/services/admin';
import { handleApiError } from '@/lib/api-error';

/**
 * DELETE /api/admin/users/[userId] – remove a user (contributor only).
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    const { userId } = await params;
    await adminService.deleteUser(userId, session.userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
