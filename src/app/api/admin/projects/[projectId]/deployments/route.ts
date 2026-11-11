import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { deploymentRepository } from '@/repositories/deployment.repository';
import { handleApiError } from '@/lib/api-error';

/**
 * GET /api/admin/projects/[projectId]/deployments – the project's 10 most recent
 * deployments, without build logs (contributor only). The logs route serves a log on demand.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    const { projectId } = await params;
    const deployments = await deploymentRepository.findByProjectId(projectId, 10);
    return NextResponse.json({ success: true, data: deployments });
  } catch (error) {
    return handleApiError(error);
  }
}
