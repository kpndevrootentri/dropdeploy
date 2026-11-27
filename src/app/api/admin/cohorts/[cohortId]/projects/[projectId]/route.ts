import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { cohortService } from '@/services/cohort';
import { moveProjectSchema } from '@/validators/cohort.validator';
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

/**
 * GET /api/admin/cohorts/[cohortId]/projects/[projectId] – the batches PATCH would accept as `toCohortId` (contributor only).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ cohortId: string; projectId: string }> },
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    const { cohortId, projectId } = await params;
    return NextResponse.json({ success: true, data: await cohortService.moveTargets(cohortId, projectId) });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * PATCH /api/admin/cohorts/[cohortId]/projects/[projectId] – move the project to another batch (contributor only).
 * Body `{ toCohortId }`. 409 when the target is archived, is this batch, or the owner is not a current student there.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ cohortId: string; projectId: string }> },
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    const { cohortId, projectId } = await params;
    const { toCohortId } = moveProjectSchema.parse(await req.json());
    const target = await cohortService.moveProject(cohortId, projectId, toCohortId, session.userId);
    return NextResponse.json({ success: true, data: { cohortId: target.id, name: target.name } });
  } catch (error) {
    return handleApiError(error);
  }
}
