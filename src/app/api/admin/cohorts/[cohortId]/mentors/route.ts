import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { cohortService } from '@/services/cohort';
import { addMentorSchema } from '@/validators/cohort.validator';
import { handleApiError } from '@/lib/api-error';

/**
 * POST /api/admin/cohorts/[cohortId]/mentors – add an existing account as a mentor of the batch (contributor only).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ cohortId: string }> },
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    const { cohortId } = await params;
    const { email } = addMentorSchema.parse(await req.json());
    const member = await cohortService.addMentor(cohortId, email, session.userId);
    return NextResponse.json({ success: true, data: member }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
