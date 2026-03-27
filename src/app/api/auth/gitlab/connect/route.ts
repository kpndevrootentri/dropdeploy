import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import * as jose from 'jose';
import { getSession } from '@/lib/get-session';
import { getRedisConnection } from '@/lib/redis';
import { getConfig } from '@/lib/config';
import { handleApiError } from '@/lib/api-error';
import { GITLAB_AUTHORIZE_URL, gitlabCallbackUrl } from '@/lib/providers/gitlab';

const OAUTH_STATE_TTL_SECONDS = 600;

/**
 * GET /api/auth/gitlab/connect
 * Redirects the authenticated user to GitLab OAuth authorization page.
 */
export async function GET(req: NextRequest): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const { GITLAB_CLIENT_ID, JWT_SECRET, APP_URL } = getConfig();

    if (!GITLAB_CLIENT_ID || !APP_URL) {
      return NextResponse.json(
        { success: false, error: { message: 'GitLab OAuth is not configured on this server' } },
        { status: 501 },
      );
    }

    const nonce = randomBytes(16).toString('hex');
    const popup = req.nextUrl.searchParams.get('popup') === '1';
    const redis = getRedisConnection();
    await redis.set(`oauth:state:${nonce}`, session.userId, 'EX', OAUTH_STATE_TTL_SECONDS);

    if (!JWT_SECRET) throw new Error('JWT_SECRET is not configured');

    const state = await new jose.SignJWT({ nonce, provider: 'GITLAB', popup, appUrl: APP_URL })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime(`${OAUTH_STATE_TTL_SECONDS}s`)
      .sign(new TextEncoder().encode(JWT_SECRET));

    const params = new URLSearchParams({
      client_id: GITLAB_CLIENT_ID,
      redirect_uri: gitlabCallbackUrl(APP_URL),
      response_type: 'code',
      scope: 'read_api read_repository',
      state,
    });

    return NextResponse.redirect(`${GITLAB_AUTHORIZE_URL}?${params}`);
  } catch (error) {
    return handleApiError(error);
  }
}
