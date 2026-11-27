import type { User } from '@prisma/client';
import { NextRequest } from 'next/server';
import { authService as auth } from '@/services/auth';
import { POST as start } from '@/app/api/admin/users/[userId]/impersonate/route';
import { POST as exit } from '@/app/api/auth/impersonation/exit/route';
import { POST as logout } from '@/app/api/auth/logout/route';

const mockUsers = new Map<string, User>();
const mockRevoked = new Set<string>();
jest.mock('@/services/auth', () => {
  const actual = jest.requireActual('@/services/auth/auth.service');
  const repo = {
    findById: async (id: string) => mockUsers.get(id) ?? null,
    findByEmail: async (email: string) => [...mockUsers.values()].find((u) => u.email === email) ?? null,
  };
  // An in-memory denylist: this suite never opens a Redis connection.
  const revoked = { add: async (jti: string) => void mockRevoked.add(jti), has: async (jti: string) => mockRevoked.has(jti) };
  return { ...actual, authService: new actual.AuthService(repo, { jwtSecret: 'x'.repeat(32), jwtExpiresIn: '1h' }, undefined, revoked) };
});
jest.mock('@/lib/prisma', () => ({ prisma: { platformEvent: { create: async () => ({}) } } }));
jest.mock('@/lib/config', () => ({ getConfig: () => ({ JWT_EXPIRES_IN: '1h' }) }));

function makeUser(overrides: Partial<User>): User {
  return {
    id: 'u1',
    email: 'dev@entri.me',
    passwordHash: '',
    role: 'USER',
    mustResetPassword: false,
    tokenVersion: 0,
    suspendedAt: null,
    ...overrides,
  } as User;
}

/** A browser cookie jar, reduced to names and paths: applies each Set-Cookie and returns the `Cookie` header a request to `path` sends. */
function jar() {
  const cookies = new Map<string, { value: string; path: string }>();
  return {
    apply(res: Response): void {
      for (const line of res.headers.getSetCookie()) {
        const [pair, ...attrs] = line.split(';').map((p) => p.trim());
        const name = pair.slice(0, pair.indexOf('='));
        const value = pair.slice(pair.indexOf('=') + 1);
        const path = attrs.find((a) => a.startsWith('Path='))?.slice(5) ?? '/';
        if (attrs.includes('Max-Age=0')) cookies.delete(name);
        else cookies.set(name, { value, path });
      }
    },
    set: (name: string, value: string) => cookies.set(name, { value, path: '/' }),
    get: (name: string) => cookies.get(name),
    header: (path: string) =>
      [...cookies]
        .filter(([, c]) => c.path === '/' || path === c.path || path.startsWith(`${c.path}/`))
        .map(([n, c]) => `${n}=${c.value}`)
        .join('; '),
  };
}

const IMPERSONATE = '/api/admin/users/u1/impersonate';
const EXIT = '/api/auth/impersonation/exit';
const LOGOUT = '/api/auth/logout';
const post = (path: string, cookie: string) =>
  new NextRequest(`http://localhost:3001${path}`, { method: 'POST', headers: { cookie } });

beforeEach(async () => {
  const bcrypt = await import('bcryptjs');
  const passwordHash = await bcrypt.hash('pass-word-123', 4);
  mockUsers.clear();
  mockUsers.set('admin', makeUser({ id: 'admin', email: 'admin@entri.me', role: 'CONTRIBUTOR', passwordHash }));
  mockUsers.set('u1', makeUser({ passwordHash }));
  mockRevoked.clear();
});

/** An admin signed in to `browser`, then viewing it as u1. Returns the admin's own session token. */
async function startViewing(browser: ReturnType<typeof jar>): Promise<string> {
  const { tokens } = await auth.login({ email: 'admin@entri.me', password: 'pass-word-123' });
  browser.set('auth-token', tokens.accessToken);
  browser.set('site-view', await auth.siteTokenFor(tokens.accessToken));
  const started = await start(post(IMPERSONATE, browser.header(IMPERSONATE)), { params: Promise.resolve({ userId: 'u1' }) });
  expect(started.status).toBe(200);
  browser.apply(started);
  return tokens.accessToken;
}

describe('view as user: cookies from start to exit', () => {
  it('keeps the session and the site-view cookie naming the same user at every step', async () => {
    const browser = jar();
    const adminToken = await startViewing(browser);
    const view = browser.get('auth-token')!.value;
    await expect(auth.verifySession(browser.get('auth-token')!.value)).resolves.toMatchObject({ userId: 'u1', impersonatorId: 'admin' });
    await expect(auth.verifySiteSession(browser.get('site-view')!.value)).resolves.toMatchObject({ userId: 'u1', impersonatorId: 'admin' });
    expect(browser.get('admin-session')).toEqual({ value: adminToken, path: '/api/auth' });
    expect(browser.header('/api/projects')).not.toContain('admin-session');

    const exited = await exit(post(EXIT, browser.header(EXIT)));
    expect(exited.status).toBe(200);
    browser.apply(exited);
    await expect(auth.verifySession(browser.get('auth-token')!.value)).resolves.toEqual(
      expect.objectContaining({ userId: 'admin', role: 'CONTRIBUTOR' }),
    );
    expect((await auth.verifySession(browser.get('auth-token')!.value)).impersonatorId).toBeUndefined();
    await expect(auth.verifySiteSession(browser.get('site-view')!.value)).resolves.toMatchObject({ userId: 'admin' });
    expect(browser.get('admin-session')).toBeUndefined();
    // Leaving the view revokes it, so a copy of the view token stops working.
    await expect(auth.verifySession(view)).rejects.toThrow(/revoked/);
  });

  it("logging out while viewing revokes the view and the admin's own session; the admin's other sessions stay signed in", async () => {
    const browser = jar();
    const adminToken = await startViewing(browser);
    const view = browser.get('auth-token')!.value;
    const { tokens: phone } = await auth.login({ email: 'admin@entri.me', password: 'pass-word-123' });

    const out = await logout(post(LOGOUT, browser.header(LOGOUT)));
    expect(out.status).toBe(200);
    browser.apply(out);
    expect(browser.header(EXIT)).toBe('');

    await expect(auth.verifySession(view)).rejects.toMatchObject({ statusCode: 401 });
    await expect(auth.verifySession(adminToken)).rejects.toMatchObject({ statusCode: 401 });
    await expect(auth.verifySession(phone.accessToken)).resolves.toMatchObject({ userId: 'admin', role: 'CONTRIBUTOR' });
  });

  it('signs out of both cookies when the restore cookie belongs to a different admin than the view', async () => {
    mockUsers.set('other', makeUser({ id: 'other', email: 'other@entri.me', role: 'CONTRIBUTOR' }));
    const { accessToken: othersView } = await auth.impersonate('other', 'u1');
    const { tokens } = await auth.login({ email: 'admin@entri.me', password: 'pass-word-123' });
    const res = await exit(post(EXIT, `auth-token=${othersView}; admin-session=${tokens.accessToken}`));
    expect(res.status).toBe(401);
    expect(res.headers.getSetCookie().map((c) => c.split('=')[0])).toEqual(['auth-token', 'site-view', 'admin-session']);
    // The browser drops both tokens here, so both are revoked.
    await expect(auth.verifySession(othersView)).rejects.toThrow(/revoked/);
    await expect(auth.verifySession(tokens.accessToken)).rejects.toThrow(/revoked/);
  });
});
