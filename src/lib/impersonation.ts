/** Closed while viewing as a user, even for GET, because they act on more than what is on screen. */
const CLOSED_WHILE_VIEWING = [
  // No admin powers from inside someone else's session.
  /^\/api\/admin(\/|$)/,
  // OAuth connect/callback are GETs that link a provider account to the session's user.
  /^\/api\/auth\/(github|gitlab)\//,
  // Lists repositories with the user's own provider token.
  /^\/api\/git-providers\/[^/]+\/repos/,
];

/**
 * Why a request on a "view as user" session is refused, or null if it may go
 * ahead. Viewing is read-only: anything but GET/HEAD is refused. The exit
 * route that ends the view never calls getSession, so it needs no exception.
 */
export function impersonationBlockReason(method: string, pathname: string): string | null {
  if (CLOSED_WHILE_VIEWING.some((pattern) => pattern.test(pathname))) {
    return 'Not available while viewing as another user';
  }
  if (method !== 'GET' && method !== 'HEAD') return 'Read-only while viewing as another user';
  return null;
}
