import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { handleApiError } from '@/lib/api-error';
import { userRepository } from '@/repositories';

/**
 * GET /api/onboarding/welcome – whether the welcome modal was already closed,
 * plus the email it greets by.
 */
export async function GET(req: NextRequest): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const seen = await userRepository.isWelcomeSeen(session.userId);
    return NextResponse.json({ success: true, data: { seen, email: session.email } });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/onboarding/welcome – the modal was closed, whichever way. No body,
 * and the write only ever sets a timestamp once, so it needs no rate limit.
 */
export async function POST(req: NextRequest): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    await userRepository.markWelcomeSeen(session.userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
