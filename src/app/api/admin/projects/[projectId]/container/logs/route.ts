import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { adminService } from '@/services/admin';
import { clampTail } from '@/lib/container-logs';
import { handleApiError } from '@/lib/api-error';

/**
 * GET /api/admin/projects/[projectId]/container/logs?tail=200 – the live
 * container's last 1–500 lines of output (contributor only). `logs` is null
 * when the project has no container.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    const { projectId } = await params;
    const tail = clampTail(req.nextUrl.searchParams.get('tail'));
    const logs = await adminService.getProjectContainerLogs(projectId, tail, session.userId);
    return NextResponse.json({ success: true, data: { logs, tail } });
  } catch (error) {
    return handleApiError(error);
  }
}
