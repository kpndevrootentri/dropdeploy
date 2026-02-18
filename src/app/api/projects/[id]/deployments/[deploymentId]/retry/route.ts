import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { deploymentService } from '@/services/deployment';
import { handleApiError } from '@/lib/api-error';

/**
 * POST /api/projects/:id/deployments/:deploymentId/retry
 * Retries a FAILED deployment. Returns 409 if the deployment is not in FAILED state.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; deploymentId: string }> }
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const { deploymentId } = await params;

    const deployment = await deploymentService.retryFailedDeployment(deploymentId, session.userId);

    return NextResponse.json({ success: true, data: { deployment } });
  } catch (error) {
    return handleApiError(error);
  }
}
