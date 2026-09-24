import { isPlatformHost, matchTenantSubdomain, mayServeTenant } from '@/lib/platform-host';

const BASE = 'app.en3.wtf';

describe('matchTenantSubdomain', () => {
  it('extracts the slug from a tenant subdomain', () => {
    expect(matchTenantSubdomain('acme.app.en3.wtf', BASE)).toBe('acme');
    expect(matchTenantSubdomain('acme.localhost:3001', 'localhost')).toBe('acme');
  });

  it('does not match the base domain itself or nested subdomains', () => {
    expect(matchTenantSubdomain('app.en3.wtf', BASE)).toBeNull();
    expect(matchTenantSubdomain('a.b.app.en3.wtf', BASE)).toBeNull();
  });

  it('does not treat regex metacharacters in the base domain as wildcards', () => {
    expect(matchTenantSubdomain('acme.appXen3Xwtf', BASE)).toBeNull();
  });

  it('never matches when no base domain is configured', () => {
    expect(matchTenantSubdomain('acme.', '')).toBeNull();
  });
});

describe('isPlatformHost', () => {
  const env = process.env;
  beforeEach(() => {
    process.env = { ...env, NEXT_PUBLIC_APP_URL: 'https://app.en3.wtf', PLATFORM_EXTRA_HOSTS: 'status.example.org' };
  });
  afterAll(() => {
    process.env = env;
  });

  it.each(['app.en3.wtf', 'APP.EN3.WTF.', 'localhost:3001', '10.0.0.5', '[::1]', 'status.example.org', ''])(
    '%s is a platform host',
    (host) => expect(isPlatformHost(host, BASE)).toBe(true),
  );

  it('treats a custom domain as a tenant host', () => {
    expect(isPlatformHost('shop.example.com', BASE)).toBe(false);
  });
});

describe('mayServeTenant', () => {
  const env = process.env;
  beforeEach(() => {
    process.env = { ...env, NEXT_PUBLIC_APP_URL: 'https://app.en3.wtf' };
  });
  afterAll(() => {
    process.env = env;
  });

  it('refuses tenant content on the dashboard host in production', () => {
    expect(mayServeTenant('app.en3.wtf', 'evil', BASE, true)).toBe(false);
  });

  it('refuses tenant content on an IP literal in production', () => {
    expect(mayServeTenant('3.109.99.141', 'evil', BASE, true)).toBe(false);
  });

  it('serves a tenant subdomain only its own slug', () => {
    expect(mayServeTenant('acme.app.en3.wtf', 'acme', BASE, true)).toBe(true);
    expect(mayServeTenant('acme.app.en3.wtf', 'evil', BASE, true)).toBe(false);
  });

  it('serves custom domains', () => {
    expect(mayServeTenant('shop.example.com', 'acme', BASE, true)).toBe(true);
  });

  it('allows /api/proxy on the dashboard host outside production (local dev links)', () => {
    expect(mayServeTenant('localhost:3001', 'acme', 'localhost', false)).toBe(true);
  });
});
