import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { cohortService } from '@/services/cohort';
import { updateCohortSchema } from '@/validators/cohort.validator';
import { handleApiError } from '@/lib/api-error';

type Ctx = { params: Promise<{ cohortId: string }> };

/**
 * GET /api/admin/cohorts/[cohortId] – the batch, its join code, everyone who was ever in it and its projects (contributor only).
 */
export async function GET(req: NextRequest, { params }: Ctx): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    const { cohortId } = await params;
    return NextResponse.json({ success: true, data: await cohortService.get(cohortId) });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * PATCH /api/admin/cohorts/[cohortId] – rename, change dates, open or close joining, archive (contributor only).
 */
export async function PATCH(req: NextRequest, { params }: Ctx): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    const { cohortId } = await params;
    const dto = updateCohortSchema.parse(await req.json());
    return NextResponse.json({ success: true, data: await cohortService.update(cohortId, dto, session.userId) });
  } catch (error) {
    return handleApiError(error);
  }
}
