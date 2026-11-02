import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { handleApiError } from '@/lib/api-error';
import { prisma } from '@/lib/prisma';
import { checkTourEndRateLimit } from '@/lib/rate-limit';
import { userRepository } from '@/repositories';
import { tourEndedSchema } from '@/validators';

/** GET /api/onboarding/tour – whether the dashboard tour has already been offered and answered. */
export async function GET(req: NextRequest): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const seen = await userRepository.isTourSeen(session.userId);
    return NextResponse.json({ success: true, data: { seen } });
  } catch (error) {
    return handleApiError(error);
  }
}

/** POST /api/onboarding/tour – the tour ended: declined, skipped or completed. */
export async function POST(req: NextRequest): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const limited = checkTourEndRateLimit(session.userId);
    if (limited) return limited;

    const dto = tourEndedSchema.parse(await req.json());
    await userRepository.markTourSeen(session.userId);

    // Recorded here rather than through the browser beacon, because this is
    // where "seen" is saved. Analytics must never fail the request.
    prisma.platformEvent
      .create({ data: { event: 'product_tour_ended', userId: session.userId, meta: dto } })
      .catch(() => {});

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
