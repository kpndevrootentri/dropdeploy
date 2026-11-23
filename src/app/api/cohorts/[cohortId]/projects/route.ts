import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { cohortService } from '@/services/cohort';
import { handleApiError } from '@/lib/api-error';

/**
 * GET /api/cohorts/[cohortId]/projects – the batch's projects with owner and latest deployment.
 * Mentors of the batch and admins only; everyone else gets a 404.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ cohortId: string }> },
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const { cohortId } = await params;
    return NextResponse.json({ success: true, data: await cohortService.listProjects(cohortId, session) });
  } catch (error) {
    return handleApiError(error);
  }
}
