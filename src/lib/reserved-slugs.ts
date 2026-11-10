/**
 * Project slugs that must never become tenant subdomains.
 *
 * A slug becomes `<slug>.<BASE_DOMAIN>`, a sibling of the dashboard on the same
 * site. Names like `login`, `admin` or `accounts` would let any user publish a
 * convincing phishing page on an official-looking platform hostname; names
 * like `www`, `mail` or `status` may be wanted by the platform itself.
 */
/**
 * A tenant container is `dropdeploy-<slug>` (containerNameFor), so these slugs would take the
 * name of the platform's own Docker resources: `caddy` → the edge container `dropdeploy-caddy`
 * (infra/caddy), `tenants` → the tenant network `dropdeploy-tenants` (TENANT_NETWORK).
 * Reserved for new projects below; the Docker-ops worker refuses them for existing ones.
 */
export const PLATFORM_RESOURCE_SLUGS: readonly string[] = ['caddy', 'tenants'];

const RESERVED_SLUGS = new Set([
  'www', 'app', 'api', 'admin', 'administrator', 'dashboard', 'console', 'panel',
  'login', 'logout', 'signin', 'signup', 'register', 'auth', 'oauth', 'sso', 'account', 'accounts',
  'password', 'reset', 'verify', 'billing', 'payments', 'pay',
  'security', 'secure', 'internal', 'root', 'system', 'platform', 'dropdeploy', 'deploy',
  'mail', 'email', 'smtp', 'imap', 'pop', 'mx', 'ftp', 'ns', 'ns1', 'ns2', 'dns',
  'cdn', 'static', 'assets', 'status', 'health', 'docs', 'help', 'support', 'blog', 'explore',
  'localhost', 'staging', 'dev', 'test',
  ...PLATFORM_RESOURCE_SLUGS,
]);

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.toLowerCase());
}
