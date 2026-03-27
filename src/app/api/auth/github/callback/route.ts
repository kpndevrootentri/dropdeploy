import { NextRequest, NextResponse } from 'next/server';
import * as jose from 'jose';
import { getRedisConnection } from '@/lib/redis';
import { getConfig } from '@/lib/config';
import { gitProviderService } from '@/services/git-provider';
import { createLogger } from '@/lib/logger';
import { exchangeGitHubCode, fetchGitHubUser, githubCallbackUrl } from '@/lib/providers/github';

const log = createLogger('github-oauth-callback');

/**
 * GET /api/auth/github/callback
 * Handles the GitHub OAuth redirect. Exchanges code for token, stores encrypted.
 */
export async function GET(req: NextRequest): Promise<NextResponse<unknown>> {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, JWT_SECRET, APP_URL } = getConfig();

  const appUrl = APP_URL ?? '';

  const plainRedirectError = (msg: string): NextResponse<unknown> =>
    NextResponse.redirect(`${appUrl}/dashboard?oauth_error=${encodeURIComponent(msg)}`);

  if (!code || !state) return plainRedirectError('Missing OAuth parameters');
  if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET || !APP_URL || !JWT_SECRET) return plainRedirectError('GitHub OAuth not configured');

  let isPopup = false;
  let openerOrigin = appUrl;

  const popupClose = (provider: string): NextResponse<unknown> =>
    new NextResponse(
      `<!DOCTYPE html><html><body><script>
        if(window.opener){window.opener.postMessage({type:'oauth_success',provider:${JSON.stringify(provider)}},${JSON.stringify(openerOrigin)});window.close();}
        else{window.location.href=${JSON.stringify(`${appUrl}/dashboard?connected=${provider.toLowerCase()}`)}}
      </script></body></html>`,
      { headers: { 'Content-Type': 'text/html' } },
    );

  const popupError = (msg: string): NextResponse<unknown> =>
    new NextResponse(
      `<!DOCTYPE html><html><body><script>
        if(window.opener){window.opener.postMessage({type:'oauth_error',error:${JSON.stringify(msg)}},${JSON.stringify(openerOrigin)});window.close();}
        else{window.location.href=${JSON.stringify(`${appUrl}/dashboard?oauth_error=${encodeURIComponent(msg)}`)}}
      </script></body></html>`,
      { headers: { 'Content-Type': 'text/html' } },
    );

  try {
    // Verify JWT signature and extract nonce + origin
    const { payload } = await jose.jwtVerify(
      state,
      new TextEncoder().encode(JWT_SECRET),
      { algorithms: ['HS256'] },
    );
    const nonce = payload.nonce as string;
    isPopup = payload.popup === true;
    if (typeof payload.appUrl === 'string') openerOrigin = payload.appUrl;

    // Atomic get+delete — prevents replay if two requests race on the same nonce
    const redis = getRedisConnection();
    const userId = await redis.getdel(`oauth:state:${nonce}`);
    if (!userId) return isPopup ? popupError('OAuth state expired or already used') : plainRedirectError('OAuth state expired or already used');

    // Exchange code for access token
    const tokenData = await exchangeGitHubCode(
      GITHUB_CLIENT_ID,
      GITHUB_CLIENT_SECRET,
      code,
      githubCallbackUrl(APP_URL),
    );
    if (!tokenData.access_token) {
      log.warn('GitHub token exchange failed', { error: tokenData.error });
      return isPopup ? popupError('GitHub token exchange failed') : plainRedirectError('GitHub token exchange failed');
    }

    // Fetch GitHub user profile
    const { ok: userOk, user: ghUser, status: userStatus } = await fetchGitHubUser(tokenData.access_token);
    if (!userOk || !ghUser) {
      log.warn('GitHub user fetch failed', { status: userStatus });
      return isPopup ? popupError('Failed to fetch GitHub profile') : plainRedirectError('Failed to fetch GitHub profile');
    }
    if (!ghUser.id || !ghUser.login) {
      return isPopup ? popupError('Invalid GitHub profile response') : plainRedirectError('Invalid GitHub profile response');
    }

    await gitProviderService.connect(userId, {
      provider: 'GITHUB',
      providerUserId: String(ghUser.id),
      username: ghUser.login,
      avatarUrl: ghUser.avatar_url,
      accessToken: tokenData.access_token,
    });

    return isPopup
      ? popupClose('GITHUB')
      : NextResponse.redirect(`${appUrl}/dashboard?connected=github`);
  } catch (err) {
    log.error('GitHub OAuth callback error', { error: String(err) });
    return isPopup
      ? popupError('An unexpected error occurred during GitHub sign-in')
      : plainRedirectError('An unexpected error occurred during GitHub sign-in');
  }
}
