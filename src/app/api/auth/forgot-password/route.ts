import { NextRequest, NextResponse, after } from 'next/server';
import { z } from 'zod';
import { inviteService } from '@/services/invite';
import { handleApiError } from '@/lib/api-error';
import { AppError } from '@/lib/errors';
import { isEmailConfigured } from '@/lib/email';
import { checkForgotPasswordRateLimit, getClientIp } from '@/lib/rate-limit';
import { createLogger } from '@/lib/logger';

const log = createLogger('forgot-password');

const forgotPasswordSchema = z.object({
  email: z.string().email().max(254),
});

/**
 * POST /api/auth/forgot-password – email a 1-hour password reset link. Public.
 * Answers the same for every address, and does the lookup and the send after
 * the response, so neither the reply nor its timing reveals which accounts exist.
 */
export async function POST(req: NextRequest): Promise<NextResponse<unknown>> {
  try {
    const { email } = forgotPasswordSchema.parse(await req.json());
    // The same answer for every address, so it reveals nothing; better than a "check your email" that never arrives.
    if (!isEmailConfigured()) {
      throw new AppError('EMAIL_OFF', "Password reset by email isn't available yet. Ask an admin for a reset link.", 503);
    }
    const limited = checkForgotPasswordRateLimit(getClientIp(req), email);
    if (limited) return limited;
    after(() =>
      inviteService.requestReset(email).catch((err) => log.error('Password reset request failed', { error: String(err) })),
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
