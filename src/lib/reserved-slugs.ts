/**
 * Project slugs that must never become tenant subdomains.
 *
 * A slug becomes `<slug>.<BASE_DOMAIN>`, a sibling of the dashboard on the same
 * site. Names like `login`, `admin` or `accounts` would let any user publish a
 * convincing phishing page on an official-looking platform hostname; names
 * like `www`, `mail` or `status` may be wanted by the platform itself.
 */
const RESERVED_SLUGS = new Set([
  'www', 'app', 'api', 'admin', 'administrator', 'dashboard', 'console', 'panel',
  'login', 'logout', 'signin', 'signup', 'register', 'auth', 'oauth', 'sso', 'account', 'accounts',
  'password', 'reset', 'verify', 'billing', 'payments', 'pay',
  'security', 'secure', 'internal', 'root', 'system', 'platform', 'dropdeploy', 'deploy',
  'mail', 'email', 'smtp', 'imap', 'pop', 'mx', 'ftp', 'ns', 'ns1', 'ns2', 'dns',
  'cdn', 'static', 'assets', 'status', 'health', 'docs', 'help', 'support', 'blog', 'explore',
  'localhost', 'staging', 'dev', 'test',
]);

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.toLowerCase());
}
