import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { cohortService } from '@/services/cohort';
import { handleApiError } from '@/lib/api-error';

/**
 * GET /api/cohorts/[cohortId] – the batch, its join link while joining is open, and its current students.
 * Mentors of the batch and admins only; everyone else gets a 404.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ cohortId: string }> },
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const { cohortId } = await params;
    return NextResponse.json({ success: true, data: await cohortService.mentorView(cohortId, session) });
  } catch (error) {
    return handleApiError(error);
  }
}
