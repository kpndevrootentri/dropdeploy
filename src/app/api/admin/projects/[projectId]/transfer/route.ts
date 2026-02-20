import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { adminService } from '@/services/admin';
import { handleApiError } from '@/lib/api-error';
import { z } from 'zod';

const transferSchema = z.object({
  newOwnerId: z.string().min(1),
});

/**
 * PATCH /api/admin/projects/[projectId]/transfer – transfer ownership (contributor only).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    const { projectId } = await params;
    const body = await req.json();
    const { newOwnerId } = transferSchema.parse(body);
    const project = await adminService.transferOwnership(projectId, newOwnerId);
    return NextResponse.json({ success: true, data: project });
  } catch (error) {
    return handleApiError(error);
  }
}
