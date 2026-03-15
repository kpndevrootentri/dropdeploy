import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { adminService } from '@/services/admin';
import { handleApiError } from '@/lib/api-error';

/**
 * PATCH /api/admin/users/[userId]/reset-password – set a new password for a user (contributor only).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    const { userId } = await params;
    const body = await req.json();
    const { newPassword } = body as { newPassword?: string };
    if (!newPassword) {
      return NextResponse.json({ success: false, error: 'newPassword is required' }, { status: 400 });
    }
    await adminService.resetUserPassword(userId, newPassword);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
