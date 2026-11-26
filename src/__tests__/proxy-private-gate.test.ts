import type { User } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { splitCookiesString } from 'next/dist/server/web/utils';
import * as jose from 'jose';
import { authService as auth } from '@/services/auth';
import { GET } from '@/app/api/proxy/[slug]/[[...path]]/route';

const findFirst = jest.fn();
const canView = jest.fn();
const mockUsers = new Map<string, User>();
const SECRET = 'x'.repeat(32);

jest.mock('@/lib/prisma', () => ({
  prisma: {
    deployment: { findFirst: (...args: unknown[]) => findFirst(...args) },
    proxyHit: { create: () => Promise.resolve() },
  },
}));

jest.mock('@/lib/config', () => ({
  getConfig: () => ({ BASE_DOMAIN: 'app.test', NODE_ENV: 'production', STATIC_SERVE_DIR: '/srv/static-sites' }),
}));

// A static file as serveStaticFile sends it for a public site, with its conditional 304.
const mockServeStaticFile = jest.fn(async (_dir: string, _path: string, opts: { ifNoneMatch?: string | null }) =>
  opts.ifNoneMatch === '"v1"'
    ? new NextResponse(null, { status: 304, headers: { ETag: '"v1"', 'Cache-Control': 'public, max-age=31536000, immutable' } })
    : new NextResponse('file', { headers: { ETag: '"v1"', 'Cache-Control': 'public, max-age=31536000, immutable' } }),
);
jest.mock('@/lib/static-serve', () => ({
  serveStaticFile: (dir: string, path: string, opts: { ifNoneMatch?: string | null }) => mockServeStaticFile(dir, path, opts),
}));

jest.mock('@/services/project-access', () => ({ projectAccessService: { canView: (...args: unknown[]) => canView(...args) } }));
jest.mock('@/services/auth', () => {
  const { AuthService } = jest.requireActual('@/services/auth/auth.service');
  const repo = { findById: async (id: string) => mockUsers.get(id) ?? null };
  return { authService: new AuthService(repo, { jwtSecret: 'x'.repeat(32), jwtExpiresIn: '1h' }) };
});

const MENTOR = {
  id: 'm1',
  email: 'mentor@entri.me',
  passwordHash: '',
  role: 'USER',
  mustResetPassword: false,
  tokenVersion: 0,
  suspendedAt: null,
} as unknown as User;

/** A session token for the mentor, as login issues it, and the site-view token made from it. */
async function mentorTokens(): Promise<{ session: string; site: string }> {
  const session = await new jose.SignJWT({ sub: 'm1', email: 'mentor@entri.me', role: 'USER', tv: 0 })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET));
  return { session, site: await auth.siteTokenFor(session) };
}

describe('private site gate', () => {
  const realFetch = global.fetch;
  const upstream = jest.fn<Promise<Response>, [string, RequestInit]>(async () => new Response('site', { status: 200 }));

  beforeEach(() => {
    jest.clearAllMocks();
    mockUsers.clear();
    mockUsers.set('m1', { ...MENTOR });
    findFirst.mockResolvedValue({
      containerPort: 4123,
      servingMethod: 'CONTAINER',
      projectId: 'p1',
      project: { id: 'p1', isPrivate: true, userId: 'u1', cohortId: 'c1' },
    });
    canView.mockResolvedValue(true);
    global.fetch = upstream as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = realFetch;
  });

  const open = (cookie?: string, extra: Record<string, string> = {}) =>
    GET(
      new NextRequest('https://shop.app.test/', { headers: { host: 'shop.app.test', ...(cookie ? { cookie } : {}), ...extra } }),
      { params: Promise.resolve({ slug: 'shop', path: ['index.html'] }) },
    );

  it('serves someone the access rules allow', async () => {
    const { site } = await mentorTokens();
    const res = await open(`site-view=${site}`);
    expect(res.status).toBe(200);
    expect(canView).toHaveBeenCalledWith(
      { id: 'p1', userId: 'u1', cohortId: 'c1' },
      { userId: 'm1', email: 'mentor@entri.me', role: 'USER' },
    );
  });

  it('refuses a signed-in user the access rules do not allow', async () => {
    canView.mockResolvedValue(false);
    const { site } = await mentorTokens();
    expect((await open(`site-view=${site}`)).status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('refuses a signed-out visitor', async () => {
    expect((await open()).status).toBe(401);
    expect((await open('theme=dark')).status).toBe(401);
    expect(canView).not.toHaveBeenCalled();
  });

  it('ignores the dashboard session, under the old name or the new one, and in the site-view cookie', async () => {
    const { session } = await mentorTokens();
    for (const cookie of [`auth-token=${session}`, `__Host-auth-token=${session}`, `site-view=${session}`]) {
      expect((await open(cookie)).status).toBe(401);
    }
    expect(canView).not.toHaveBeenCalled();
  });

  it('trusts neither site-view cookie when a second one has been planted', async () => {
    const { site } = await mentorTokens();
    expect((await open(`site-view=${site}; site-view=${site}`)).status).toBe(401);
  });

  it('never trusts a nameless "=site-view=<valid token>" pair, alone or beside the real one', async () => {
    const { site } = await mentorTokens();
    expect((await open(`=site-view=${site}`)).status).toBe(401);
    expect((await open(`=site-view=${site}; site-view=${site}`)).status).toBe(401);
    expect(canView).not.toHaveBeenCalled();
  });

  it('refuses a site-view cookie once its session is revoked', async () => {
    const { site } = await mentorTokens();
    mockUsers.set('m1', { ...MENTOR, tokenVersion: 1 });
    expect((await open(`site-view=${site}`)).status).toBe(401);
  });

  it('refuses a site-view cookie for a deleted or suspended user', async () => {
    const { site } = await mentorTokens();
    mockUsers.set('m1', { ...MENTOR, suspendedAt: new Date() });
    expect((await open(`site-view=${site}`)).status).toBe(401);
    mockUsers.delete('m1');
    expect((await open(`site-view=${site}`)).status).toBe(401);
    expect(canView).not.toHaveBeenCalled();
  });

  it('refuses a session still on an invited or admin-reset password, before any access check', async () => {
    const { site } = await mentorTokens();
    mockUsers.set('m1', { ...MENTOR, mustResetPassword: true });
    const res = await open(`site-view=${site}`);
    expect(res.status).not.toBe(200);
    expect(canView).not.toHaveBeenCalled();
    expect(upstream).not.toHaveBeenCalled();
  });

  it('never forwards either platform cookie to the tenant app, and drops its Set-Cookie for them', async () => {
    const tenantCookies = new Headers();
    for (const c of [
      'app_session=1; Path=/',
      '__Host-auth-token=evil; Path=/; Secure',
      'auth-token=evil; Domain=.app.test; Path=/',
      'site-view=evil; Domain=.app.test; Path=/',
    ]) {
      tenantCookies.append('set-cookie', c);
    }
    upstream.mockResolvedValueOnce(new Response('site', { status: 200, headers: tenantCookies }));
    const { session, site } = await mentorTokens();

    const res = await open(`app_session=1; site-view=${site}; __Host-auth-token=${session}; auth-token=${session}`);

    expect(res.status).toBe(200);
    const forwarded = new Headers(upstream.mock.calls[0][1]?.headers);
    expect(forwarded.get('cookie')).toBe('app_session=1');
    expect(res.headers.getSetCookie()).toEqual(['app_session=1; Path=/']);
  });

  it('splits a comma-joined tenant Set-Cookie line and drops the platform cookies in it, nameless ones too', async () => {
    const tenantCookies = new Headers();
    // One raw header line; Next splits it on commas when it writes the response.
    tenantCookies.append('set-cookie', 'tenant_ok=1; Path=/, site-view=PLANTED; Domain=.app.test; Path=/; Secure; HttpOnly, auth-token=PLANTED2; Domain=.app.test; Path=/');
    tenantCookies.append('set-cookie', '=site-view=PLANTED3; Domain=.app.test; Path=/');
    tenantCookies.append('set-cookie', '=__Host-auth-token=PLANTED4; Path=/; Secure');
    upstream.mockResolvedValueOnce(new Response('site', { status: 200, headers: tenantCookies }));
    const { site } = await mentorTokens();

    const res = await open(`site-view=${site}`);

    expect(res.headers.getSetCookie()).toEqual(['tenant_ok=1; Path=/']);
    // What Next will put on the wire.
    expect(res.headers.getSetCookie().flatMap(splitCookiesString)).toEqual(['tenant_ok=1; Path=/']);
  });

  it("strips a tenant's Clear-Site-Data, which would wipe the dashboard session", async () => {
    upstream.mockResolvedValueOnce(new Response('site', { status: 200, headers: { 'Clear-Site-Data': '"cookies"', 'X-Tenant': 'kept' } }));
    const { site } = await mentorTokens();
    const res = await open(`site-view=${site}`);
    expect(res.headers.get('clear-site-data')).toBeNull();
    expect(res.headers.get('x-tenant')).toBe('kept');
  });

  it('marks a private container response private, no-cache, whatever the tenant sent', async () => {
    upstream.mockResolvedValueOnce(new Response('site', { status: 200, headers: { 'Cache-Control': 'public, max-age=600' } }));
    const { site } = await mentorTokens();
    expect((await open(`site-view=${site}`)).headers.get('cache-control')).toBe('private, no-cache');
  });

  it("leaves a public container response's caching to the tenant", async () => {
    findFirst.mockResolvedValue({
      containerPort: 4123,
      servingMethod: 'CONTAINER',
      projectId: 'p1',
      project: { id: 'p1', isPrivate: false, userId: 'u1', cohortId: null },
    });
    upstream.mockResolvedValueOnce(new Response('site', { status: 200, headers: { 'Cache-Control': 'public, max-age=600' } }));
    expect((await open()).headers.get('cache-control')).toBe('public, max-age=600');
  });

  const staticSite = (isPrivate: boolean) =>
    findFirst.mockResolvedValue({
      containerPort: null,
      servingMethod: 'STATIC_FILES',
      projectId: 'p1',
      project: { id: 'p1', isPrivate, userId: 'u1', cohortId: null },
    });

  it('serves a private static file private, no-cache, and leaves a public one cacheable', async () => {
    const { site } = await mentorTokens();
    staticSite(true);
    const priv = await open(`site-view=${site}`);
    expect(priv.status).toBe(200);
    expect(priv.headers.get('cache-control')).toBe('private, no-cache');
    staticSite(false);
    expect((await open()).headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });

  it('runs the gate before any 304: a conditional request without access is denied, with access it revalidates', async () => {
    const { site } = await mentorTokens();
    staticSite(true);
    const etag = { 'if-none-match': '"v1"' };

    expect((await open(undefined, etag)).status).toBe(401);
    canView.mockResolvedValueOnce(false);
    expect((await open(`site-view=${site}`, etag)).status).toBe(401);
    expect(mockServeStaticFile).not.toHaveBeenCalled();

    const revalidated = await open(`site-view=${site}`, etag);
    expect(revalidated.status).toBe(304);
    expect(revalidated.headers.get('cache-control')).toBe('private, no-cache');
  });

  it('denies a conditional request to a private container site before it reaches the container', async () => {
    expect((await open(undefined, { 'if-none-match': '"v1"' })).status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });
});
