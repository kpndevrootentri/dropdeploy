import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { adminService } from '@/services/admin';
import { handleApiError } from '@/lib/api-error';
import { z } from 'zod';

const changeRoleSchema = z.object({
  role: z.enum(['USER', 'CONTRIBUTOR']),
});

/**
 * PATCH /api/admin/users/[userId]/role – change a user's role (contributor only).
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
    const { role } = changeRoleSchema.parse(body);
    const user = await adminService.changeUserRole(userId, role, session.userId);
    return NextResponse.json({ success: true, data: user });
  } catch (error) {
    return handleApiError(error);
  }
}
