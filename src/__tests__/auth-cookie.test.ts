import { NextResponse } from 'next/server';
import { clearAuthCookie, getTokenFromCookieHeader, isAuthSetCookie, setAuthCookie, withoutAuthCookie } from '@/lib/auth-cookie';

const env = process.env as Record<string, string | undefined>;

/** Runs `fn` with NODE_ENV and BASE_DOMAIN set as in a deployment, then restores them. */
function inEnv(nodeEnv: string, baseDomain: string, fn: () => void): void {
  const saved = { NODE_ENV: env.NODE_ENV, BASE_DOMAIN: env.BASE_DOMAIN };
  Object.assign(env, { NODE_ENV: nodeEnv, BASE_DOMAIN: baseDomain });
  try {
    fn();
  } finally {
    Object.assign(env, saved);
  }
}

/** Each Set-Cookie the writer adds, as `{ name, value, attrs }` with lower-cased attribute names. */
function setCookies(write: (res: NextResponse) => void) {
  const res = NextResponse.json({});
  write(res);
  return res.headers.getSetCookie().map((line) => {
    const [pair, ...attrs] = line.split(';').map((part) => part.trim());
    const eq = pair.indexOf('=');
    return {
      name: pair.slice(0, eq),
      value: pair.slice(eq + 1),
      attrs: Object.fromEntries(attrs.map((a) => [a.split('=')[0].toLowerCase(), a.split('=')[1] ?? true])),
    };
  });
}

const session = { path: '/', secure: true, httponly: true, samesite: 'lax' };

describe('auth cookie handling', () => {
  it('reads a single auth-token', () => {
    expect(getTokenFromCookieHeader('theme=dark; auth-token=abc.def; x=1')).toBe('abc.def');
  });

  it('trusts neither token when a second auth-token has been planted', () => {
    expect(getTokenFromCookieHeader('auth-token=attacker; auth-token=victim')).toBeUndefined();
  });

  it('ignores cookies whose name merely contains auth-token', () => {
    expect(getTokenFromCookieHeader('x-auth-token=zzz; auth-token=abc')).toBe('abc');
  });

  it('does not read a pair with no "=" as the cookie whose name is one character shorter', () => {
    expect(getTokenFromCookieHeader('auth-tokenX')).toBeUndefined();
    expect(getTokenFromCookieHeader('auth-tokenX; auth-token=abc')).toBe('abc');
  });

  it('counts a nameless "=auth-token=…" pair only as a duplicate, never as the token', () => {
    expect(getTokenFromCookieHeader('=auth-token=planted; auth-token=real')).toBeUndefined();
    expect(getTokenFromCookieHeader('=auth-token=planted')).toBeUndefined();
  });

  it('returns undefined with no cookie header or an empty value', () => {
    expect(getTokenFromCookieHeader(null)).toBeUndefined();
    expect(getTokenFromCookieHeader('auth-token=')).toBeUndefined();
  });

  it('recognises a tenant Set-Cookie for any platform cookie', () => {
    expect(isAuthSetCookie('auth-token=evil; Domain=.app.en3.wtf; Path=/api; HttpOnly')).toBe(true);
    expect(isAuthSetCookie(' auth-token =evil')).toBe(true);
    expect(isAuthSetCookie('__Host-auth-token=evil; Path=/; Secure')).toBe(true);
    expect(isAuthSetCookie('site-view=evil; Domain=.app.en3.wtf; Path=/')).toBe(true);
    expect(isAuthSetCookie('session=abc; Path=/')).toBe(false);
  });

  it('recognises a nameless tenant Set-Cookie whose value starts with a platform cookie name', () => {
    expect(isAuthSetCookie('=site-view=evil; Domain=.app.en3.wtf; Path=/')).toBe(true);
    expect(isAuthSetCookie('=__Host-auth-token=evil; Path=/; Secure')).toBe(true);
    expect(isAuthSetCookie('site-view')).toBe(true);
  });

  it('gives no session for a lone nameless "=__Host-auth-token=<jwt>" in production', () => {
    inEnv('production', 'entrify.site', () => {
      expect(getTokenFromCookieHeader('=__Host-auth-token=eyJhbGciOiJIUzI1NiJ9.e30.sig')).toBeUndefined();
      expect(getTokenFromCookieHeader('= __Host-auth-token=eyJhbGciOiJIUzI1NiJ9.e30.sig; theme=dark')).toBeUndefined();
    });
  });

  it('reads only the __Host- session in production, never the old parent-domain name', () => {
    inEnv('production', 'entrify.site', () => {
      expect(getTokenFromCookieHeader('auth-token=planted; __Host-auth-token=real')).toBe('real');
      expect(getTokenFromCookieHeader('auth-token=planted; site-view=site')).toBeUndefined();
    });
  });
});

describe('session and site-view cookie attributes', () => {
  it('production: a host-only __Host- session, a parent-domain site-view cookie, and the legacy cookie expired', () => {
    inEnv('production', 'entrify.site', () => {
      const cookies = setCookies((res) => setAuthCookie(res, 'jwt', 'site-jwt', 600));
      expect(cookies).toEqual([
        { name: '__Host-auth-token', value: 'jwt', attrs: expect.objectContaining({ ...session, 'max-age': '600' }) },
        { name: 'site-view', value: 'site-jwt', attrs: expect.objectContaining({ ...session, 'max-age': '600', domain: '.entrify.site' }) },
        { name: 'auth-token', value: '', attrs: expect.objectContaining({ path: '/', 'max-age': '0', domain: '.entrify.site' }) },
      ]);
      expect(cookies[0].attrs).not.toHaveProperty('domain');
    });
  });

  it('production logout clears all three', () => {
    inEnv('production', 'entrify.site', () => {
      const cookies = setCookies(clearAuthCookie);
      expect(cookies.map((c) => [c.name, c.value, c.attrs['max-age'], c.attrs.domain])).toEqual([
        ['__Host-auth-token', '', '0', undefined],
        ['site-view', '', '0', '.entrify.site'],
        ['auth-token', '', '0', '.entrify.site'],
      ]);
    });
  });

  it('development: the old name, host-only and not Secure, so plain http on localhost still works', () => {
    inEnv('development', 'localhost:3001', () => {
      const dev = { path: '/', httponly: true, samesite: 'lax', 'max-age': '600' };
      const cookies = setCookies((res) => setAuthCookie(res, 'jwt', 'site-jwt', 600));
      expect(cookies).toEqual([
        { name: 'auth-token', value: 'jwt', attrs: expect.objectContaining(dev) },
        { name: 'site-view', value: 'site-jwt', attrs: expect.objectContaining(dev) },
      ]);
      for (const c of cookies) expect(c.attrs).not.toHaveProperty('domain');
      for (const c of cookies) expect(c.attrs).not.toHaveProperty('secure');
      expect(setCookies(clearAuthCookie).map((c) => [c.name, c.attrs['max-age']])).toEqual([
        ['auth-token', '0'],
        ['site-view', '0'],
      ]);
    });
  });
});

describe('withoutAuthCookie', () => {
  it('forwards app cookies and drops the platform session', () => {
    expect(withoutAuthCookie('sessionid=abc; auth-token=jwt; csrftoken=xyz')).toBe('sessionid=abc; csrftoken=xyz');
  });

  it('drops every copy of auth-token, including planted duplicates', () => {
    expect(withoutAuthCookie('auth-token=a; theme=dark; auth-token=b')).toBe('theme=dark');
  });

  it('drops nameless and "="-less copies of platform cookies', () => {
    expect(withoutAuthCookie('=site-view=x; app=1; site-view; auth-tokenX=1')).toBe('app=1; auth-tokenX=1');
  });

  it('drops the __Host- session and the site-view cookie too', () => {
    expect(withoutAuthCookie('__Host-auth-token=s; app=1; site-view=v; auth-token=old')).toBe('app=1');
  });

  it('returns null when only the platform cookie was present', () => {
    expect(withoutAuthCookie('auth-token=jwt')).toBeNull();
    expect(withoutAuthCookie(null)).toBeNull();
  });

  it('keeps cookies whose names merely contain auth-token', () => {
    expect(withoutAuthCookie('my-auth-token=1')).toBe('my-auth-token=1');
  });
});
