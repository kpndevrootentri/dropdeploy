const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * True when a state-changing request was sent by a page on another origin.
 *
 * `SameSite=Lax` does not stop these: tenant sites live on sibling subdomains
 * of the dashboard, which browsers treat as the same *site*, so the auth
 * cookie rides along on a cross-origin POST from any tenant page. What does
 * distinguish them is the origin, and browsers always send `Origin` on a
 * non-GET request that crosses one — `no-cors` and plain form posts included.
 *
 * Requests with neither header are let through: the CLI (Bearer token), the
 * GitHub webhook and server-to-server callers are not browsers, and cannot
 * carry a victim's cookie anyway.
 *
 * Dependency-free: called from `src/proxy.ts` on every API request.
 */
export function isForeignOriginMutation(
  method: string,
  host: string,
  origin: string | null,
  secFetchSite: string | null,
): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return false;

  if (origin !== null) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      // `Origin: null` (sandboxed iframe, opaque redirect) or garbage.
      return true;
    }
    // Compare host *and* port: localhost:3001 and localhost:4000 (a tenant
    // container in dev) are different origins.
    return originHost.toLowerCase() !== host.toLowerCase().replace(/\.$/, '');
  }

  // No Origin: fall back to Fetch Metadata where the browser sent it.
  return secFetchSite === 'cross-site' || secFetchSite === 'same-site';
}
