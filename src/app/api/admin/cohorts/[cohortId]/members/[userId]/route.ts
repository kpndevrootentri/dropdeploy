import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { cohortService } from '@/services/cohort';
import { handleApiError } from '@/lib/api-error';

/**
 * DELETE /api/admin/cohorts/[cohortId]/members/[userId] – end a membership (contributor only).
 * The row is kept with an end date, and the person's projects keep the batch.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ cohortId: string; userId: string }> },
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    const { cohortId, userId } = await params;
    await cohortService.endMembership(cohortId, userId, session.userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
