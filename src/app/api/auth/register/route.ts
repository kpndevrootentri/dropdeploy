import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/services/auth';
import { cohortService } from '@/services/cohort';
import { registerSchema } from '@/validators/auth.validator';
import { handleApiError } from '@/lib/api-error';
import { ForbiddenError } from '@/lib/errors';
import { checkJoinRegisterRateLimit, checkRegisterRateLimit, getClientIp } from '@/lib/rate-limit';
import { setAuthCookie, parseExpiresInToSeconds } from '@/lib/auth-cookie';
import { getConfig } from '@/lib/config';
import { createLogger } from '@/lib/logger';
import { platformSettingsService } from '@/services/platform-settings/platform-settings.service';

const log = createLogger('register');

export async function POST(req: NextRequest): Promise<NextResponse<unknown>> {
  try {
    const dto = registerSchema.parse(await req.json());
    const ip = getClientIp(req);
    const limited = dto.joinCode ? checkJoinRegisterRateLimit(ip) : checkRegisterRateLimit(ip);
    if (limited) return limited;
    // A batch join link is its own invitation: it opens sign-up even when sign-up is closed.
    if (dto.joinCode) {
      await cohortService.assertJoinable(dto.joinCode);
    } else if (!(await platformSettingsService.isSignupOpen())) {
      throw new ForbiddenError('Registration is closed. Ask an administrator for an account.');
    }
    const result = await authService.register(dto);

    let joined = false;
    if (dto.joinCode) {
      try {
        await cohortService.join(dto.joinCode, result.userId);
        joined = true;
      } catch (err) {
        // The code closed between the check and now: keep the account; opening the link again retries.
        log.warn('Signed up but could not join the batch', { userId: result.userId, error: String(err) });
      }
    }

    const res = NextResponse.json({
      success: true,
      data: { userId: result.userId, email: dto.email, joined },
    });
    const maxAge = parseExpiresInToSeconds(getConfig().JWT_EXPIRES_IN);
    setAuthCookie(res, result.tokens.accessToken, await authService.siteTokenFor(result.tokens.accessToken), maxAge);
    return res;
  } catch (error) {
    return handleApiError(error);
  }
}
