import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { deploymentRepository } from '@/repositories/deployment.repository';
import { handleApiError } from '@/lib/api-error';
import { NotFoundError } from '@/lib/errors';

/**
 * GET /api/admin/projects/[projectId]/deployments/[deploymentId]/logs – one
 * deployment's build log (contributor only).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string; deploymentId: string }> },
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    const { projectId, deploymentId } = await params;
    const deployment = await deploymentRepository.findById(deploymentId);
    if (!deployment || deployment.projectId !== projectId) throw new NotFoundError('Deployment');
    return NextResponse.json({
      success: true,
      data: { buildLog: deployment.buildLog ?? null, status: deployment.status },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
