const ACCOUNT_ONLY_MESSAGE = 'API tokens cannot use this endpoint. Sign in to the dashboard instead.';
const DEPLOY_ONLY_MESSAGE = 'This token can only deploy. Create a Full access token at /settings for this.';

/** Closed to every API token: they act on the account itself, not on one site. */
const ACCOUNT_ONLY = [
  /^\/api\/admin(\/|$)/,
  /^\/api\/auth(\/|$)/,
  // A token must not mint or revoke tokens, or one leaked token could outlive its own revocation.
  /^\/api\/tokens(\/|$)/,
  /^\/api\/onboarding(\/|$)/,
  /^\/api\/cohorts(\/|$)/,
  // OAuth links and repository lists use the user's own provider token.
  /^\/api\/git-providers(\/|$)/,
  /^\/api\/projects\/[^/]+\/terminal(\/|$)/,
];

/**
 * Everything a Deploy only token may call: what the CLI and the Claude Desktop extension need to ship a site.
 * Not POST /api/projects or /api/detect-type: both reach git repositories with the user's linked GitHub/GitLab
 * token, so a leaked Deploy only token could publish any private repository the user can read.
 */
const DEPLOY_ALLOWED: [method: string, path: RegExp][] = [
  ['GET', /^\/api\/projects$/],
  ['POST', /^\/api\/projects\/upload$/],
  ['POST', /^\/api\/projects\/[^/]+\/upload$/],
  ['POST', /^\/api\/projects\/[^/]+\/deploy$/],
  ['GET', /^\/api\/projects\/[^/]+\/deployments$/],
  ['GET', /^\/api\/projects\/[^/]+\/deployments\/[^/]+\/logs$/],
  ['GET', /^\/api\/projects\/[^/]+\/deployments\/[^/]+\/logs\/stream$/],
  ['POST', /^\/api\/projects\/[^/]+\/deployments\/[^/]+\/rollback$/],
  ['POST', /^\/api\/projects\/[^/]+\/deployments\/[^/]+\/cancel$/],
  ['GET', /^\/api\/projects\/[^/]+$/],
];

/**
 * Empty or dot segments, or any percent-encoding: refused rather than normalised, so no spelling can dodge the
 * lists. Next's production router decodes the path before matching a route (/api/t%6fkens reaches /api/tokens),
 * but the handler sees it still encoded. Ids and slugs never contain '%'.
 */
export const AMBIGUOUS_PATH = /\/\/|\/\.\.?(\/|$)|%/;

/**
 * Why a request made with an API token is refused, or null if it may go ahead.
 * Full access tokens may call anything but the account-level endpoints; Deploy
 * only tokens may call just the list above. Cookie and login-JWT sessions never
 * pass here.
 */
export function apiTokenBlockReason(scope: 'DEPLOY' | 'FULL', method: string, pathname: string): string | null {
  const verb = method.toUpperCase() === 'HEAD' ? 'GET' : method.toUpperCase();
  if (verb === 'OPTIONS' || AMBIGUOUS_PATH.test(pathname)) return ACCOUNT_ONLY_MESSAGE;
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  if (ACCOUNT_ONLY.some((pattern) => pattern.test(path))) return ACCOUNT_ONLY_MESSAGE;
  if (scope === 'FULL') return null;
  return DEPLOY_ALLOWED.some(([m, pattern]) => m === verb && pattern.test(path)) ? null : DEPLOY_ONLY_MESSAGE;
}
