import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { cohortService } from '@/services/cohort';
import { handleApiError } from '@/lib/api-error';

/**
 * GET /api/cohorts – the signed-in user's current batches and their role in each.
 */
export async function GET(req: NextRequest): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const memberships = await cohortService.myMemberships(session.userId);
    return NextResponse.json({
      success: true,
      data: memberships.map(({ role, joinedAt, cohort }) => ({
        role,
        joinedAt,
        // No join code here; mentors get it from GET /api/cohorts/[cohortId] while joining is open.
        cohort: { id: cohort.id, name: cohort.name, program: cohort.program, startsAt: cohort.startsAt, endsAt: cohort.endsAt },
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
