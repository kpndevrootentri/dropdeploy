import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/get-session';
import { authService } from '@/services/auth';
import { handleApiError } from '@/lib/api-error';
import { setAuthCookie, parseExpiresInToSeconds } from '@/lib/auth-cookie';
import { getConfig } from '@/lib/config';

const resetPasswordSchema = z.object({
  // Optional only for a forced reset: the user just signed in with a temporary
  // password an admin set, so the session itself is that proof.
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
});

export async function POST(req: NextRequest): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const body = await req.json();
    const { currentPassword, newPassword } = resetPasswordSchema.parse(body);
    const tokens = session.mustResetPassword
      ? await authService.resetPassword(session.userId, newPassword)
      : await authService.changePassword(session.userId, currentPassword ?? '', newPassword);
    const res = NextResponse.json({ success: true });
    const maxAge = parseExpiresInToSeconds(getConfig().JWT_EXPIRES_IN);
    setAuthCookie(res, tokens.accessToken, maxAge);
    return res;
  } catch (error) {
    return handleApiError(error);
  }
}
