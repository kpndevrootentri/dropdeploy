import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { adminService } from '@/services/admin';
import { handleApiError } from '@/lib/api-error';

const suspendSchema = z.object({ suspended: z.boolean() });

/**
 * PATCH /api/admin/users/[userId]/suspend – suspend or reinstate a user (contributor only).
 * Suspension blocks sign-in and revokes every session; the user's sites keep running.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    const { userId } = await params;
    const { suspended } = suspendSchema.parse(await req.json());
    const user = await adminService.setUserSuspended(userId, suspended, session.userId);
    return NextResponse.json({ success: true, data: user });
  } catch (error) {
    return handleApiError(error);
  }
}
