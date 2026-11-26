import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { apiTokenService } from '@/services/api-token';
import { authService } from '@/services/auth';
import { createApiTokenSchema } from '@/validators/api-token.validator';
import { handleApiError } from '@/lib/api-error';
import { ValidationError } from '@/lib/errors';
import { checkPasswordChangeRateLimit } from '@/lib/rate-limit';

// API tokens never reach these handlers (lib/api-token-scope.ts), and a "view as user" session
// is read-only (lib/impersonation.ts), so only the user's own sign-in can create or revoke tokens.

/**
 * GET /api/tokens – the user's API tokens, newest first. Revoked and expired
 * tokens are included (marked by revokedAt / expiresAt) so the list explains
 * why an old token stopped working. Never includes the token or its hash.
 */
export async function GET(req: NextRequest): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const tokens = await apiTokenService.list(session.userId);
    return NextResponse.json({ success: true, data: { tokens } });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/tokens – create a token. Body: { name, scope?: 'DEPLOY' | 'FULL', expiresInDays?: 30 | 90 | 365 | null }.
 * The plaintext token is in this response only.
 */
export async function POST(req: NextRequest): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    // The password-change limit also caps password guesses made here.
    const limited = checkPasswordChangeRateLimit(session.userId);
    if (limited) return limited;
    const parsed = createApiTokenSchema.safeParse(await req.json());
    if (!parsed.success) {
      throw new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid input');
    }
    const { password, ...input } = parsed.data;
    await authService.confirmPassword(session.userId, password);
    const created = await apiTokenService.create(session.userId, input);
    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
