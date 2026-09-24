import { NextRequest, NextResponse } from 'next/server';
import * as jose from 'jose';
import { getRedisConnection } from '@/lib/redis';
import { getConfig } from '@/lib/config';
import { getSession } from '@/lib/get-session';
import { gitProviderService } from '@/services/git-provider';
import { createLogger } from '@/lib/logger';
import { exchangeGitLabCode, fetchGitLabUser, gitlabCallbackUrl } from '@/lib/providers/gitlab';

const log = createLogger('gitlab-oauth-callback');

/**
 * GET /api/auth/gitlab/callback
 * Handles the GitLab OAuth redirect. Exchanges code, stores encrypted token + refresh token.
 */
export async function GET(req: NextRequest): Promise<NextResponse<unknown>> {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const { GITLAB_CLIENT_ID, GITLAB_CLIENT_SECRET, JWT_SECRET, APP_URL } = getConfig();

  const appUrl = APP_URL ?? '';

  const plainRedirectError = (msg: string): NextResponse<unknown> =>
    NextResponse.redirect(`${appUrl}/dashboard?oauth_error=${encodeURIComponent(msg)}`);

  if (!code || !state) return plainRedirectError('Missing OAuth parameters');
  if (!GITLAB_CLIENT_ID || !GITLAB_CLIENT_SECRET || !APP_URL || !JWT_SECRET) return plainRedirectError('GitLab OAuth not configured');

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
    const { payload } = await jose.jwtVerify(
      state,
      new TextEncoder().encode(JWT_SECRET),
      { algorithms: ['HS256'] },
    );
    const nonce = payload.nonce as string;
    isPopup = payload.popup === true;
    if (typeof payload.appUrl === 'string') openerOrigin = payload.appUrl;

    const redis = getRedisConnection();
    const userId = await redis.getdel(`oauth:state:${nonce}`);
    if (!userId) return isPopup ? popupError('OAuth state expired or already used') : plainRedirectError('OAuth state expired or already used');

    // The state proves which account *started* this flow; the session proves
    // the browser finishing it is signed in to that same account. Without this
    // check an attacker can send a victim an authorize URL carrying the
    // attacker's state, and the victim's token lands on the attacker's account.
    const session = await getSession(req).catch(() => null);
    if (session?.userId !== userId) {
      const msg = 'Sign in to the account that started this connection and try again';
      return isPopup ? popupError(msg) : plainRedirectError(msg);
    }

    // Exchange code for tokens (GitLab returns access + refresh + expires_in)
    const tokenData = await exchangeGitLabCode(
      GITLAB_CLIENT_ID,
      GITLAB_CLIENT_SECRET,
      code,
      gitlabCallbackUrl(APP_URL),
    );
    if (!tokenData.access_token) {
      log.warn('GitLab token exchange failed or missing access_token');
      return isPopup ? popupError('GitLab token exchange failed') : plainRedirectError('GitLab token exchange failed');
    }

    // Fetch GitLab user profile
    const { ok: userOk, user: glUser, status: userStatus } = await fetchGitLabUser(tokenData.access_token);
    if (!userOk || !glUser) {
      log.warn('GitLab user fetch failed', { status: userStatus });
      return isPopup ? popupError('Failed to fetch GitLab profile') : plainRedirectError('Failed to fetch GitLab profile');
    }
    if (!glUser.id || !glUser.username) {
      return isPopup ? popupError('Invalid GitLab profile response') : plainRedirectError('Invalid GitLab profile response');
    }

    await gitProviderService.connect(userId, {
      provider: 'GITLAB',
      providerUserId: String(glUser.id),
      username: glUser.username,
      avatarUrl: glUser.avatar_url,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token ?? null,
      expiresInSeconds: typeof tokenData.expires_in === 'number' ? tokenData.expires_in : null,
    });

    return isPopup
      ? popupClose('GITLAB')
      : NextResponse.redirect(`${appUrl}/dashboard?connected=gitlab`);
  } catch (err) {
    log.error('GitLab OAuth callback error', { error: String(err) });
    return isPopup
      ? popupError('An unexpected error occurred during GitLab sign-in')
      : plainRedirectError('An unexpected error occurred during GitLab sign-in');
  }
}
