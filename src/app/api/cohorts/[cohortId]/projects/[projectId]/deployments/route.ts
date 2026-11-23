import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { cohortService } from '@/services/cohort';
import { handleApiError } from '@/lib/api-error';

/**
 * GET /api/cohorts/[cohortId]/projects/[projectId]/deployments – the project's last 10 deployments,
 * read-only, for mentors of the batch and admins.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ cohortId: string; projectId: string }> },
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const { cohortId, projectId } = await params;
    return NextResponse.json({ success: true, data: await cohortService.listDeployments(cohortId, projectId, session) });
  } catch (error) {
    return handleApiError(error);
  }
}
