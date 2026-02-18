import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { projectService } from '@/services/project';
import { deploymentRepository } from '@/repositories/deployment.repository';
import { handleApiError } from '@/lib/api-error';

const PAGE_LIMIT = 5;

/**
 * GET /api/projects/:id/deployments?skip=N&limit=N
 * Returns a paginated list of deployments for a project (excludes buildLog for size).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const { id } = await params;

    // Ownership check (throws NotFoundError if missing or wrong user)
    await projectService.getById(id, session.userId);

    const url = new URL(req.url);
    const skip = Math.max(0, parseInt(url.searchParams.get('skip') ?? '0', 10));
    const limit = Math.min(
      PAGE_LIMIT,
      Math.max(1, parseInt(url.searchParams.get('limit') ?? String(PAGE_LIMIT), 10))
    );

    const [deployments, total] = await Promise.all([
      deploymentRepository.findByProjectId(id, limit, skip),
      deploymentRepository.countByProjectId(id),
    ]);

    // Strip buildLog to keep response small; the per-deployment log endpoint serves it on demand
    const deploymentSummaries = deployments.map(({ buildLog: _b, ...rest }) => rest);

    return NextResponse.json({ success: true, data: { deployments: deploymentSummaries, total } });
  } catch (error) {
    return handleApiError(error);
  }
}
