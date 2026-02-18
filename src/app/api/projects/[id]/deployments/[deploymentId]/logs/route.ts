import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { deploymentService } from '@/services/deployment';
import { handleApiError } from '@/lib/api-error';

/**
 * GET /api/projects/:id/deployments/:deploymentId/logs
 * Returns { buildLog, status, commitHash } for a deployment.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; deploymentId: string }> }
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const { deploymentId } = await params;

    const deployment = await deploymentService.getById(deploymentId, session.userId);

    return NextResponse.json({
      success: true,
      data: {
        buildLog: deployment.buildLog ?? null,
        status: deployment.status,
        commitHash: deployment.commitHash ?? null,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
