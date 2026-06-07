import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { adminService } from '@/services/admin';
import { handleApiError } from '@/lib/api-error';

const updateQuotaSchema = z.object({
  projectQuota: z.number().int().min(0),
});

/**
 * PATCH /api/admin/users/[userId]/quota – update a user's project quota (contributor only).
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
    const { projectQuota } = updateQuotaSchema.parse(body);
    const user = await adminService.updateUserQuota(userId, projectQuota);
    return NextResponse.json({ success: true, data: user });
  } catch (error) {
    return handleApiError(error);
  }
}
