import { NextRequest, NextResponse } from 'next/server';

const isProduction = (): boolean => process.env.NODE_ENV === 'production';

/** What the dashboard session cookie was called while it was shared across `.BASE_DOMAIN`. No longer trusted. */
export const LEGACY_AUTH_COOKIE = 'auth-token';

/**
 * The dashboard session cookie. In production it is `__Host-`: browsers only
 * take such a cookie host-only, Secure and on Path=/, so no tenant subdomain
 * can set one for the dashboard. Development runs on plain http (LAN IPs too),
 * where a Secure cookie is refused, so there it keeps the old name, host-only.
 */
export function authCookieName(): string {
  return isProduction() ? '__Host-auth-token' : LEGACY_AUTH_COOKIE;
}

/**
 * Tells the private-URL gate on `{slug}.BASE_DOMAIN` who is visiting. Shared
 * across `.BASE_DOMAIN`, but it holds a token signed with its own key (see
 * `AuthService.siteTokenFor`), so it never passes as a dashboard session or a
 * Bearer token, and a session never passes as one of these.
 */
export const SITE_COOKIE_NAME = 'site-view';

/** Never forwarded to tenant apps, and never settable by them. */
const PLATFORM_COOKIES = new Set([LEGACY_AUTH_COOKIE, '__Host-auth-token', SITE_COOKIE_NAME]);

/**
 * Holds an admin's own session while they view the dashboard as another user.
 * Host-only and scoped to `/api/auth`, so no tenant subdomain and no route
 * outside auth receives it; exit restores it and logout revokes it.
 * Renamed from `admin-restore` (scoped to the exit route) so a copy left at the
 * old path is never read again and can't collide with this one.
 */
export const ADMIN_RESTORE_COOKIE = 'admin-session';
const ADMIN_RESTORE_PATH = '/api/auth';

/** 7 days in seconds */
const DEFAULT_MAX_AGE = 7 * 24 * 60 * 60;

/**
 * Derives the cookie domain from BASE_DOMAIN so the site-view cookie is shared
 * across all {slug}.BASE_DOMAIN subdomains (needed for private URL auth).
 * Only applied in production — in development the domain is left unset so
 * the browser accepts the cookie on localhost.
 */
function getCookieDomain(): string | undefined {
  if (!isProduction()) return undefined;
  const base = (process.env.BASE_DOMAIN ?? '').split(':')[0]; // strip port
  if (!base || base === 'localhost') return undefined;
  return `.${base}`;
}

/** Reads the session JWT from a raw `Cookie` header. See {@link authCookieName}. */
export function getTokenFromCookieHeader(cookieHeader: string | null): string | undefined {
  return readSingleCookie(cookieHeader, authCookieName());
}

/**
 * The value of cookie `name`, or undefined if it is missing or sent more than once.
 * A browser sends every matching cookie, so a copy planted on the parent domain
 * shows up as a second one; we cannot tell which is genuine, so we trust neither.
 */
function readSingleCookie(cookieHeader: string | null, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  const copies = cookieHeader.split(';').filter((pair) => splitPair(pair)[0] === name);
  // A nameless `=name=…` copy only ever counts as a duplicate; its value is never trusted.
  if (copies.length !== 1 || copies[0].trim().startsWith('=')) return undefined;
  return splitPair(copies[0])[1] || undefined;
}

/** The admin session saved while viewing as a user. Same one-cookie rule as the auth cookie. */
export function getAdminRestoreToken(request: NextRequest): string | undefined {
  return readSingleCookie(request.headers.get('cookie'), ADMIN_RESTORE_COOKIE);
}

export function setAdminRestoreCookie(response: NextResponse, token: string, maxAgeSeconds: number): void {
  response.cookies.set(ADMIN_RESTORE_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: maxAgeSeconds,
    path: ADMIN_RESTORE_PATH,
  });
}

export function clearAdminRestoreCookie(response: NextResponse): void {
  setAdminRestoreCookie(response, '', 0);
}

/**
 * Reads the JWT from the session cookie. See {@link getTokenFromCookieHeader}.
 */
export function getTokenFromCookie(request: NextRequest): string | undefined {
  return getTokenFromCookieHeader(request.headers.get('cookie'));
}

/** The site-view token, for the private-URL gate only. See {@link SITE_COOKIE_NAME}. */
export function getSiteToken(request: NextRequest): string | undefined {
  return readSingleCookie(request.headers.get('cookie'), SITE_COOKIE_NAME);
}

/**
 * `name=value` → [name, value]; a pair with no `=` is a name with an empty value.
 * A nameless pair whose value starts with a cookie name (`=site-view=x`) is
 * matched to that name, so it is stripped, dropped and counted as a duplicate.
 * No tested browser stores or sends one; the readers never return its value.
 */
function splitPair(pair: string): [string, string] {
  const p = pair.trim().replace(/^=/, '');
  const eq = p.indexOf('=');
  return eq === -1 ? [p.trim(), ''] : [p.slice(0, eq).trim(), p.slice(eq + 1).trim()];
}

/**
 * A `Cookie` header with the platform's cookies removed (the session, its
 * legacy name and the site-view cookie), or null if nothing else is left.
 * Tenant apps get their own cookies (sessions, CSRF tokens, preferences) but
 * never the visitor's platform tokens.
 */
export function withoutAuthCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const kept = cookieHeader
    .split(';')
    .map((pair) => pair.trim())
    .filter((pair) => pair && !PLATFORM_COOKIES.has(splitPair(pair)[0]));
  return kept.length > 0 ? kept.join('; ') : null;
}

/**
 * True when one `Set-Cookie` cookie from a tenant app would set one of the
 * platform's cookies. The in-app proxy drops these: a tenant must never be
 * able to sign a visitor into a different account. Takes a single cookie: a
 * comma-joined header line must be split first (see the proxy route).
 */
export function isAuthSetCookie(setCookie: string): boolean {
  return PLATFORM_COOKIES.has(splitPair(setCookie.split(';', 1)[0])[0]);
}

/**
 * Signs the browser in: the host-only session cookie, and the site-view cookie
 * for the same user (`authService.siteTokenFor(token)`), with the same lifetime.
 */
export function setAuthCookie(
  response: NextResponse,
  token: string,
  siteToken: string,
  maxAgeSeconds: number = DEFAULT_MAX_AGE
): void {
  const options = { httpOnly: true, secure: isProduction(), sameSite: 'lax', maxAge: maxAgeSeconds, path: '/' } as const;
  response.cookies.set(authCookieName(), token, options);
  response.cookies.set(SITE_COOKIE_NAME, siteToken, { ...options, domain: getCookieDomain() });
  expireLegacyAuthCookie(response);
}

/**
 * Clears the session and site-view cookies (logout).
 */
export function clearAuthCookie(response: NextResponse): void {
  setAuthCookie(response, '', '', 0);
}

/** Removes a leftover parent-domain `auth-token`. In development that name is the live session, so it is left alone. */
function expireLegacyAuthCookie(response: NextResponse): void {
  if (authCookieName() === LEGACY_AUTH_COOKIE) return;
  response.cookies.set(LEGACY_AUTH_COOKIE, '', { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 0, path: '/', domain: getCookieDomain() });
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
