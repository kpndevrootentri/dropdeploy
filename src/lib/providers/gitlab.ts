/**
 * GitLab API client — all GitLab-specific URLs, types, and fetch logic live here.
 */

export const GITLAB_BASE_URL        = 'https://gitlab.com';
export const GITLAB_API_BASE_URL    = `${GITLAB_BASE_URL}/api/v4`;
export const GITLAB_AUTHORIZE_URL   = `${GITLAB_BASE_URL}/oauth/authorize`;
export const GITLAB_TOKEN_URL       = `${GITLAB_BASE_URL}/oauth/token`;
export const GITLAB_USER_URL        = `${GITLAB_API_BASE_URL}/user`;
export const GITLAB_PROJECTS_URL    = `${GITLAB_API_BASE_URL}/projects`;

/** Path appended to APP_URL to form the OAuth redirect URI. */
export const GITLAB_CALLBACK_PATH = '/api/auth/gitlab/callback';
export const gitlabCallbackUrl = (appUrl: string): string => `${appUrl}${GITLAB_CALLBACK_PATH}`;

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

export interface GitLabTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

export interface GitLabUser {
  id: number;
  username: string;
  avatar_url: string;
}

interface GLRepo {
  id: number;
  name: string;
  path_with_namespace: string;
  http_url_to_repo: string;
  visibility: string;
  default_branch: string | null;
  description: string | null;
  last_activity_at: string;
}

export interface RepoItem {
  id: string;
  name: string;
  fullName: string;
  url: string;
  private: boolean;
  defaultBranch: string;
  description: string | null;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

/** Exchange an OAuth authorization code for tokens. GitLab returns refresh token + expiry. */
export async function exchangeGitLabCode(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<GitLabTokenResponse> {
  const res = await fetch(GITLAB_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) return {};
  return res.json() as Promise<GitLabTokenResponse>;
}

/** Use a refresh token to obtain a new access token. Returns empty object on failure. */
export async function refreshGitLabToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
  redirectUri: string,
): Promise<GitLabTokenResponse> {
  const res = await fetch(GITLAB_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) return {};
  return res.json() as Promise<GitLabTokenResponse>;
}

/** Fetch the authenticated user's GitLab profile. */
export async function fetchGitLabUser(accessToken: string): Promise<{ ok: boolean; user?: GitLabUser; status: number }> {
  const res = await fetch(GITLAB_USER_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return { ok: false, status: res.status };
  const user = await res.json() as GitLabUser;
  return { ok: true, status: res.status, user };
}

/** List projects the authenticated user is a member of, with optional keyword search. */
export async function fetchGitLabRepos(accessToken: string, query: string, page: number): Promise<RepoItem[]> {
  const params = new URLSearchParams({
    membership: 'true',
    order_by: 'last_activity_at',
    per_page: '50',
    page: String(page),
  });
  if (query) params.set('search', query);

  const res = await fetch(`${GITLAB_PROJECTS_URL}?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitLab API error ${res.status}: ${text}`);
  }

  const data = await res.json() as GLRepo[];
  return data.map((r) => ({
    id: String(r.id),
    name: r.name,
    fullName: r.path_with_namespace,
    url: r.http_url_to_repo,
    private: r.visibility !== 'public',
    defaultBranch: r.default_branch ?? 'main',
    description: r.description ?? null,
    updatedAt: r.last_activity_at,
  }));
}
