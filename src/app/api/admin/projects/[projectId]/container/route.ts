import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { adminService } from '@/services/admin';
import { handleApiError } from '@/lib/api-error';

/**
 * GET /api/admin/projects/[projectId]/container – fetch Docker container details (contributor only).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    const { projectId } = await params;
    const info = await adminService.getProjectContainerInfo(projectId);
    return NextResponse.json({ success: true, data: info });
  } catch (error) {
    return handleApiError(error);
  }
}
