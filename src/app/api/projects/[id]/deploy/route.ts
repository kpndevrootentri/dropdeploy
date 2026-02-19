import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { deploymentService } from '@/services/deployment';
import { handleApiError } from '@/lib/api-error';

/**
 * POST /api/projects/:id/deploy – create deployment (e.g. for GITHUB projects).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const { id: projectId } = await params;

    const { deployment, queued } = await deploymentService.createDeployment(projectId, session.userId);
    const message = queued
      ? 'Deployment queued — will start when the current build completes.'
      : 'Deployment started.';

    return NextResponse.json({
      success: true,
      data: { deploymentId: deployment.id, message, queued },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
