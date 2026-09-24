import { normalizeHostKey } from './host-key';

/**
 * Host classification shared by `src/proxy.ts` and the in-app proxy route.
 *
 * Deliberately dependency-free (no Zod, no `getConfig()`): the proxy imports it
 * on the hot path for every request, and a config error must not take down
 * every request rather than one route.
 */

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Returns the tenant slug when `hostname` is `{slug}.{baseDomain}` (with an
 * optional `:port` for local dev), otherwise `null`.
 */
export function matchTenantSubdomain(hostname: string, baseDomain: string): string | null {
  if (!baseDomain) return null;
  const pattern = new RegExp(`^([a-z0-9][a-z0-9-]*)\\.${escapeRegex(baseDomain)}(?::\\d+)?$`);
  return hostname.match(pattern)?.[1] ?? null;
}

/**
 * True for hostnames that belong to the platform itself rather than to a
 * tenant. These must always fall through to the dashboard/auth guard and must
 * never be looked up as custom domains.
 *
 * IP literals count as platform hosts: local development and LAN testing reach
 * the app by raw IP (see `src/lib/local-ip.ts`), and health checks often do
 * too. Treating them as unknown tenant hosts would 404 all of that.
 *
 * `PLATFORM_EXTRA_HOSTS` is the escape hatch for every other named host an
 * operator points at this app — a monitoring alias, a staging CNAME, an
 * internal health check that connects by name. Without it, turning the feature
 * on would 404 them all.
 */
export function isPlatformHost(hostname: string, baseDomain: string): boolean {
  const host = normalizeHostKey(hostname);
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  // IPv4 literal, or an IPv6 literal in brackets.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[')) return true;
  if (baseDomain && (host === baseDomain || host.endsWith(`.${baseDomain}`))) return true;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL;
  if (appUrl) {
    try {
      if (host === new URL(appUrl).hostname.toLowerCase()) return true;
    } catch {
      // Malformed APP_URL — nothing to compare against.
    }
  }

  const extra = process.env.PLATFORM_EXTRA_HOSTS;
  if (extra) {
    for (const entry of extra.split(',')) {
      const allowed = normalizeHostKey(entry.trim());
      if (allowed && (host === allowed || host.endsWith(`.${allowed}`))) return true;
    }
  }

  return false;
}

/**
 * Whether tenant content for `slug` may be served to a request for `hostname`.
 *
 * Tenant HTML must never be served on a platform origin. On the dashboard host
 * it would run same-origin with the dashboard's API, so any user could publish
 * a page that acts with the full session of whoever opens it. The in-app proxy
 * route is only meant to be reached through the host rewrite in `src/proxy.ts`,
 * which always hands it one of two things:
 *  - a tenant subdomain, whose slug must match the one being served;
 *  - a custom domain, which is by definition not a platform host.
 *
 * Anything else is a direct hit on `/api/proxy/...`, and is refused. Local
 * development is the one exception, because there the dashboard links static
 * sites as `localhost:3001/api/proxy/{slug}` (see `src/lib/project-url.ts`).
 */
export function mayServeTenant(
  hostname: string,
  slug: string,
  baseDomain: string,
  isProduction: boolean,
): boolean {
  if (!isProduction) return true;
  const subdomainSlug = matchTenantSubdomain(hostname, baseDomain);
  if (subdomainSlug !== null) return subdomainSlug === slug;
  return !isPlatformHost(hostname, baseDomain);
}
