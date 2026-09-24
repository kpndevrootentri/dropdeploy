import { NextRequest, NextResponse } from 'next/server';

export const AUTH_COOKIE_NAME = 'auth-token';

/** 7 days in seconds */
const DEFAULT_MAX_AGE = 7 * 24 * 60 * 60;

/**
 * Derives the cookie domain from BASE_DOMAIN so the auth cookie is shared
 * across all {slug}.BASE_DOMAIN subdomains (needed for private URL auth).
 * Only applied in production — in development the domain is left unset so
 * the browser accepts the cookie on localhost.
 */
function getCookieDomain(): string | undefined {
  if (process.env.NODE_ENV !== 'production') return undefined;
  const base = (process.env.BASE_DOMAIN ?? '').split(':')[0]; // strip port
  if (!base || base === 'localhost') return undefined;
  return `.${base}`;
}

/**
 * Reads the JWT from a raw `Cookie` header.
 *
 * The cookie is scoped to the parent domain, so any tenant page on a sibling
 * subdomain can plant its own `auth-token` there with `document.cookie` — say,
 * one holding the attacker's session, on a narrower path so the browser sends
 * it first. The victim would then act inside the attacker's account (and, for
 * instance, connect their GitHub to it). A browser sends every matching cookie,
 * so a planted one shows up as a second `auth-token`. When there is more than
 * one we cannot tell which is genuine, so we trust neither: the user is signed
 * out rather than signed in as someone else.
 */
export function getTokenFromCookieHeader(cookieHeader: string | null): string | undefined {
  if (!cookieHeader) return undefined;
  const values = cookieHeader
    .split(';')
    .map((pair) => pair.trim())
    .filter((pair) => pair.slice(0, pair.indexOf('=')).trim() === AUTH_COOKIE_NAME)
    .map((pair) => pair.slice(pair.indexOf('=') + 1).trim());
  return values.length === 1 && values[0] ? values[0] : undefined;
}

/**
 * Reads the JWT from the auth cookie. See {@link getTokenFromCookieHeader}.
 */
export function getTokenFromCookie(request: NextRequest): string | undefined {
  return getTokenFromCookieHeader(request.headers.get('cookie'));
}

/**
 * True when a `Set-Cookie` header from a tenant app would set the platform's
 * auth cookie. The in-app proxy drops these: a tenant must never be able to
 * sign a visitor into a different account.
 */
export function isAuthSetCookie(setCookie: string): boolean {
  const pair = setCookie.split(';', 1)[0];
  const eq = pair.indexOf('=');
  return (eq === -1 ? pair : pair.slice(0, eq)).trim() === AUTH_COOKIE_NAME;
}

/**
 * Sets the auth cookie on the response with the JWT.
 */
export function setAuthCookie(
  response: NextResponse,
  token: string,
  maxAgeSeconds: number = DEFAULT_MAX_AGE
): void {
  response.cookies.set(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: maxAgeSeconds,
    path: '/',
    domain: getCookieDomain(),
  });
}

/**
 * Clears the auth cookie (logout).
 */
export function clearAuthCookie(response: NextResponse): void {
  response.cookies.set(AUTH_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
    domain: getCookieDomain(),
  });
}

/**
 * Parses JWT_EXPIRES_IN (e.g. "7d") to seconds for cookie maxAge.
 */
export function parseExpiresInToSeconds(expiresIn: string): number {
  const match = expiresIn.match(/^(\d+)([dhms])$/);
  if (!match) return DEFAULT_MAX_AGE;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case 'd':
      return value * 24 * 60 * 60;
    case 'h':
      return value * 60 * 60;
    case 'm':
      return value * 60;
    case 's':
      return value;
    default:
      return DEFAULT_MAX_AGE;
  }
}
