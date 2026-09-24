import { getTokenFromCookieHeader, isAuthSetCookie } from '@/lib/auth-cookie';

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

  it('returns undefined with no cookie header or an empty value', () => {
    expect(getTokenFromCookieHeader(null)).toBeUndefined();
    expect(getTokenFromCookieHeader('auth-token=')).toBeUndefined();
  });

  it('recognises a tenant Set-Cookie for the platform auth cookie', () => {
    expect(isAuthSetCookie('auth-token=evil; Domain=.app.en3.wtf; Path=/api; HttpOnly')).toBe(true);
    expect(isAuthSetCookie(' auth-token =evil')).toBe(true);
    expect(isAuthSetCookie('session=abc; Path=/')).toBe(false);
  });
});
