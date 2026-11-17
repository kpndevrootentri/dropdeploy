import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { cohortService } from '@/services/cohort';
import { createCohortSchema } from '@/validators/cohort.validator';
import { handleApiError } from '@/lib/api-error';

/**
 * GET /api/admin/cohorts – every batch with member and project counts (contributor only).
 */
export async function GET(req: NextRequest): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    const [cohorts, enabled] = await Promise.all([cohortService.list(), cohortService.isEnabled()]);
    return NextResponse.json({ success: true, data: { cohorts, enabled } });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/admin/cohorts – create a batch with a fresh join code (contributor only).
 */
export async function POST(req: NextRequest): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    const dto = createCohortSchema.parse(await req.json());
    const cohort = await cohortService.create(dto, session.userId);
    return NextResponse.json({ success: true, data: cohort }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
