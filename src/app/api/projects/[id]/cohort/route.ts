import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/get-session';
import { cohortService } from '@/services/cohort';
import { handleApiError } from '@/lib/api-error';

const addToBatchSchema = z.object({ cohortId: z.string().min(1) });

/**
 * POST /api/projects/[id]/cohort – the owner puts this project in their batch.
 * Body: { cohortId } – the batch they confirmed; a 409 means it changed since the page loaded.
 * Only an admin can take a project out again.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const { id } = await params;
    // A missing or non-JSON body is a validation error (400), not a crash.
    const { cohortId } = addToBatchSchema.parse(await req.json().catch(() => null));
    const cohort = await cohortService.addProject(id, session.userId, cohortId);
    return NextResponse.json({ success: true, data: { id: cohort.id, name: cohort.name } });
  } catch (error) {
    return handleApiError(error);
  }
}
