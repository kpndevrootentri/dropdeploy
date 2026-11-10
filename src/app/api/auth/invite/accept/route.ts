import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { inviteService } from '@/services/invite';
import { handleApiError } from '@/lib/api-error';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { passwordSchema } from '@/validators/auth.validator';

const acceptSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});

/**
 * POST /api/auth/invite/accept – a new user sets their password from an invite link. Public.
 * Takes only the token, never an email, and answers every bad token the same
 * way, so it cannot be used to find out which accounts exist.
 */
export async function POST(req: NextRequest): Promise<NextResponse<unknown>> {
  try {
    const limited = checkRateLimit(`invite-accept:${getClientIp(req)}`, { windowMs: 15 * 60_000, max: 20 });
    if (limited) return limited;
    const { token, password } = acceptSchema.parse(await req.json());
    await inviteService.accept(token, password);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
