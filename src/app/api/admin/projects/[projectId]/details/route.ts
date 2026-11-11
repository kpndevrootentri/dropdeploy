import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { adminToolsService } from '@/services/admin/admin-tools.service';
import { handleApiError } from '@/lib/api-error';

/**
 * GET /api/admin/projects/[projectId]/details – env var keys, collaborators,
 * domains and live container usage for the admin drawer (contributor only).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    const { projectId } = await params;
    return NextResponse.json({ success: true, data: await adminToolsService.getProjectDetails(projectId) });
  } catch (error) {
    return handleApiError(error);
  }
}
