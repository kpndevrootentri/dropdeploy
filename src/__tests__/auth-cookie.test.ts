import { getTokenFromCookieHeader, isAuthSetCookie, withoutAuthCookie } from '@/lib/auth-cookie';

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

describe('withoutAuthCookie', () => {
  it('forwards app cookies and drops the platform session', () => {
    expect(withoutAuthCookie('sessionid=abc; auth-token=jwt; csrftoken=xyz')).toBe('sessionid=abc; csrftoken=xyz');
  });

  it('drops every copy of auth-token, including planted duplicates', () => {
    expect(withoutAuthCookie('auth-token=a; theme=dark; auth-token=b')).toBe('theme=dark');
  });

  it('returns null when only the platform cookie was present', () => {
    expect(withoutAuthCookie('auth-token=jwt')).toBeNull();
    expect(withoutAuthCookie(null)).toBeNull();
  });

  it('keeps cookies whose names merely contain auth-token', () => {
    expect(withoutAuthCookie('my-auth-token=1')).toBe('my-auth-token=1');
  });
});
