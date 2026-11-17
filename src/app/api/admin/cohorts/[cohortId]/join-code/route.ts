import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { cohortService } from '@/services/cohort';
import { handleApiError } from '@/lib/api-error';

/**
 * POST /api/admin/cohorts/[cohortId]/join-code – replace the join code; old links stop working (contributor only).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ cohortId: string }> },
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    const { cohortId } = await params;
    return NextResponse.json({ success: true, data: await cohortService.rotateJoinCode(cohortId, session.userId) });
  } catch (error) {
    return handleApiError(error);
  }
}
