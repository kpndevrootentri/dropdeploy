import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { deploymentService } from '@/services/deployment';
import { auditLogRepository } from '@/repositories/audit-log.repository';
import { handleApiError } from '@/lib/api-error';

type RouteCtx = { params: Promise<{ id: string; deploymentId: string }> };

/**
 * POST /api/projects/:id/deployments/:deploymentId/rollback
 * Queues a deployment that re-runs :deploymentId's image. Owner only.
 */
export async function POST(req: NextRequest, { params }: RouteCtx): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const { id, deploymentId } = await params;
    const { deployment, queued } = await deploymentService.createRollback(id, session.userId, deploymentId);

    auditLogRepository.create({
      action: 'DEPLOY_ROLLBACK',
      targetKey: deploymentId,
      userId: session.userId,
      projectId: id,
    }).catch(() => {});

    return NextResponse.json({ success: true, data: { deploymentId: deployment.id, queued } });
  } catch (error) {
    return handleApiError(error);
  }
}
