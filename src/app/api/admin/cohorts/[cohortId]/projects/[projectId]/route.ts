import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { cohortService } from '@/services/cohort';
import { handleApiError } from '@/lib/api-error';

/**
 * DELETE /api/admin/cohorts/[cohortId]/projects/[projectId] – take a project out of the batch (contributor only).
 * Its mentors lose access on their next request. The student can add it again while they are still a member.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ cohortId: string; projectId: string }> },
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    const { cohortId, projectId } = await params;
    await cohortService.removeProject(cohortId, projectId, session.userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
