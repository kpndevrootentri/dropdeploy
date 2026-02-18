import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { deploymentService } from '@/services/deployment';
import { handleApiError } from '@/lib/api-error';

/**
 * POST /api/projects/:id/deployments/:deploymentId/cancel
 * Cancels a QUEUED deployment. Returns 409 if already past QUEUED state.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; deploymentId: string }> }
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const { deploymentId } = await params;

    const deployment = await deploymentService.cancelDeployment(deploymentId, session.userId);

    return NextResponse.json({ success: true, data: { deployment } });
  } catch (error) {
    return handleApiError(error);
  }
}
