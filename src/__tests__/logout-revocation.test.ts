import type { User } from '@prisma/client';
import { NextRequest } from 'next/server';
import * as jose from 'jose';
import { authService as auth } from '@/services/auth';
import { getSession } from '@/lib/get-session';
import { handleApiError } from '@/lib/api-error';
import { redisRevokedSessions } from '@/lib/revoked-sessions';
import { POST as logout } from '@/app/api/auth/logout/route';

const SECRET = 'x'.repeat(32);
const mockUsers = new Map<string, User>();
/** Fake Redis: key → expiry time in ms, honouring `SET … EX` the way Redis does. */
const mockKeys = new Map<string, number>();
let mockRedisDown = false;
/** EXISTS calls made while Redis was down; ioredis would hold each in its offline queue. */
let mockQueuedChecks = 0;

jest.mock('@/lib/redis', () => {
  // ioredis with maxRetriesPerRequest: null queues commands while Redis is down and never answers.
  const hang = (): Promise<never> => new Promise(() => {});
  return {
    withRedisTimeout: jest.requireActual('@/lib/redis').withRedisTimeout,
    getRedisConnection: () => ({
      status: mockRedisDown ? 'reconnecting' : 'ready',
      set: async (key: string, _value: string, _ex: 'EX', ttl: number) =>
        mockRedisDown ? hang() : (mockKeys.set(key, Date.now() + ttl * 1000), 'OK'),
      exists: async (key: string) => {
        if (mockRedisDown) return (mockQueuedChecks++, hang());
        if ((mockKeys.get(key) ?? Infinity) <= Date.now()) mockKeys.delete(key);
        return mockKeys.has(key) ? 1 : 0;
      },
    }),
  };
});

jest.mock('@/services/auth', () => {
  const { AuthService } = jest.requireActual('@/services/auth/auth.service');
  const repo = {
    findById: async (id: string) => mockUsers.get(id) ?? null,
    findByEmail: async (email: string) => [...mockUsers.values()].find((u) => u.email === email) ?? null,
  };
  // The default store: the real Redis-backed one, over the fake connection above.
  return { authService: new AuthService(repo, { jwtSecret: 'x'.repeat(32), jwtExpiresIn: '1h' }) };
});

async function signIn(): Promise<{ session: string; site: string }> {
  const { tokens } = await auth.login({ email: 'dev@entri.me', password: 'pass-word-123' });
  return { session: tokens.accessToken, site: await auth.siteTokenFor(tokens.accessToken) };
}

const apiRequest = (headers: Record<string, string>): NextRequest =>
  new NextRequest('http://localhost:3001/api/projects', { headers });

/** The status an API route would answer with for this request's session. */
const statusOf = (req: NextRequest): Promise<number> => getSession(req).then(() => 200, (e) => handleApiError(e).status);

const logOut = (session: string): Promise<Response> =>
  logout(new NextRequest('http://localhost:3001/api/auth/logout', { method: 'POST', headers: { cookie: `auth-token=${session}` } }));

beforeEach(async () => {
  const bcrypt = await import('bcryptjs');
  mockUsers.clear();
  mockUsers.set('u1', {
    id: 'u1',
    email: 'dev@entri.me',
    passwordHash: await bcrypt.hash('pass-word-123', 4),
    role: 'USER',
    mustResetPassword: false,
    tokenVersion: 0,
    suspendedAt: null,
  } as unknown as User);
  mockKeys.clear();
  mockRedisDown = false;
  mockQueuedChecks = 0;
  jest.restoreAllMocks();
});

describe('logout revokes that session', () => {
  it('rejects the logged-out token as a cookie, as a Bearer token and at the private-site gate; other sessions stay signed in', async () => {
    const laptop = await signIn();
    const phone = await signIn();

    const res = await logOut(laptop.session);
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().find((c) => c.startsWith('auth-token='))).toMatch(/^auth-token=;.*Max-Age=0/);

    expect(await statusOf(apiRequest({ cookie: `auth-token=${laptop.session}` }))).toBe(401);
    expect(await statusOf(apiRequest({ authorization: `Bearer ${laptop.session}` }))).toBe(401);
    await expect(auth.verifySiteSession(laptop.site)).rejects.toThrow(/revoked/);

    expect(await statusOf(apiRequest({ cookie: `auth-token=${phone.session}` }))).toBe(200);
    expect(await statusOf(apiRequest({ authorization: `Bearer ${phone.session}` }))).toBe(200);
    await expect(auth.verifySiteSession(phone.site)).resolves.toMatchObject({ userId: 'u1' });
  });

  it("keeps the entry only for the token's remaining lifetime, then drops it", async () => {
    const { session } = await signIn();
    const { jti, exp } = await auth.verifyToken(session);
    await logOut(session);

    const expiresAt = mockKeys.get(`revoked-session:${jti}`)!;
    expect(Math.abs(expiresAt - exp * 1000)).toBeLessThan(2_000);

    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(expiresAt + 1);
    expect(await redisRevokedSessions.has(jti!)).toBe(false);
    expect(mockKeys.size).toBe(0);
    jest.spyOn(Date, 'now').mockReturnValue(now);
  });

  it('leaves a token issued before this change (no jti) working until it expires', async () => {
    const legacy = await new jose.SignJWT({ sub: 'u1', email: 'dev@entri.me', role: 'USER', tv: 0 })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));
    await logOut(legacy);
    expect(mockKeys.size).toBe(0);
    expect(await statusOf(apiRequest({ authorization: `Bearer ${legacy}` }))).toBe(200);
  });

  it('does not lock everyone out or queue a check per request while Redis is down, and logout still clears the cookies', async () => {
    const { session, site } = await signIn();
    mockRedisDown = true;

    expect(await statusOf(apiRequest({ cookie: `auth-token=${session}` }))).toBe(200);
    await expect(auth.verifySiteSession(site)).resolves.toMatchObject({ userId: 'u1' });
    expect(mockQueuedChecks).toBe(0);
    const res = await logOut(session);
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().find((c) => c.startsWith('auth-token='))).toMatch(/Max-Age=0/);
  });
});
