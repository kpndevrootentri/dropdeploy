import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { adminToolsService } from '@/services/admin/admin-tools.service';
import { handleApiError } from '@/lib/api-error';

/**
 * DELETE /api/admin/projects/[projectId]/access/[accessId] – remove a collaborator (contributor only).
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string; accessId: string }> },
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    const { projectId, accessId } = await params;
    await adminToolsService.revokeAccess(projectId, accessId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
