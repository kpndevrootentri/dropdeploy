import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import * as jose from 'jose';
import { getSession } from '@/lib/get-session';
import { getRedisConnection } from '@/lib/redis';
import { getConfig } from '@/lib/config';
import { handleApiError } from '@/lib/api-error';
import { GITHUB_AUTHORIZE_URL, githubCallbackUrl } from '@/lib/providers/github';

const OAUTH_STATE_TTL_SECONDS = 600; // 10 minutes

/**
 * GET /api/auth/github/connect
 * Redirects the authenticated user to GitHub OAuth authorization page.
 */
export async function GET(req: NextRequest): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const { GITHUB_CLIENT_ID, JWT_SECRET, APP_URL } = getConfig();

    if (!GITHUB_CLIENT_ID || !APP_URL) {
      return NextResponse.json(
        { success: false, error: { message: 'GitHub OAuth is not configured on this server' } },
        { status: 501 },
      );
    }

    // Generate a one-time nonce stored in Redis to prevent CSRF replay attacks
    const nonce = randomBytes(16).toString('hex');
    const popup = req.nextUrl.searchParams.get('popup') === '1';
    const redis = getRedisConnection();
    await redis.set(`oauth:state:${nonce}`, session.userId, 'EX', OAUTH_STATE_TTL_SECONDS);

    if (!JWT_SECRET) throw new Error('JWT_SECRET is not configured');

    const state = await new jose.SignJWT({ nonce, provider: 'GITHUB', popup, appUrl: APP_URL })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime(`${OAUTH_STATE_TTL_SECONDS}s`)
      .sign(new TextEncoder().encode(JWT_SECRET));

    const params = new URLSearchParams({
      client_id: GITHUB_CLIENT_ID,
      redirect_uri: githubCallbackUrl(APP_URL),
      scope: 'repo read:user',
      state,
    });

    return NextResponse.redirect(`${GITHUB_AUTHORIZE_URL}?${params}`);
  } catch (error) {
    return handleApiError(error);
  }
}
