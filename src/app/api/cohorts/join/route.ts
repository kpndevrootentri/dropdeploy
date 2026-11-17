import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/get-session';
import { cohortService } from '@/services/cohort';
import { joinCodeSchema } from '@/validators/cohort.validator';
import { handleApiError } from '@/lib/api-error';
import { checkRateLimit } from '@/lib/rate-limit';

/**
 * POST /api/cohorts/join – the signed-in user joins a batch as a student.
 * Joining a batch you are already in is harmless.
 */
export async function POST(req: NextRequest): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const limited = checkRateLimit(`cohort-join:${session.userId}`, { windowMs: 15 * 60_000, max: 20 });
    if (limited) return limited;
    const { code } = z.object({ code: joinCodeSchema }).parse(await req.json());
    const cohort = await cohortService.join(code, session.userId);
    return NextResponse.json({ success: true, data: { id: cohort.id, name: cohort.name } });
  } catch (error) {
    return handleApiError(error);
  }
}
