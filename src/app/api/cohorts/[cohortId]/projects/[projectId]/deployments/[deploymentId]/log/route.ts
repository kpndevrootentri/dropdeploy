import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { cohortService } from '@/services/cohort';
import { handleApiError } from '@/lib/api-error';

/**
 * GET /api/cohorts/[cohortId]/projects/[projectId]/deployments/[deploymentId]/log – one build log,
 * read-only, for mentors of the batch and admins.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ cohortId: string; projectId: string; deploymentId: string }> },
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const { cohortId, projectId, deploymentId } = await params;
    return NextResponse.json({
      success: true,
      data: await cohortService.getBuildLog(cohortId, projectId, deploymentId, session),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
