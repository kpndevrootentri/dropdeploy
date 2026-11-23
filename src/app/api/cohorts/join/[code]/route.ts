import { NextRequest, NextResponse } from 'next/server';
import { cohortService } from '@/services/cohort';
import { joinCodeSchema } from '@/validators/cohort.validator';
import { handleApiError } from '@/lib/api-error';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

/**
 * GET /api/cohorts/join/[code] – the batch a join link leads to, for the join page. Public.
 * Every unusable code gets the same answer.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
): Promise<NextResponse<unknown>> {
  try {
    const limited = checkRateLimit(`cohort-preview:${getClientIp(req)}`, { windowMs: 15 * 60_000, max: 60 });
    if (limited) return limited;
    const code = joinCodeSchema.parse((await params).code);
    return NextResponse.json({ success: true, data: await cohortService.preview(code) });
  } catch (error) {
    return handleApiError(error);
  }
}
