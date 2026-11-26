import type { User } from '@prisma/client';
import { NextRequest } from 'next/server';
import { authService as auth } from '@/services/auth';
import { POST as start } from '@/app/api/admin/users/[userId]/impersonate/route';
import { POST as exit } from '@/app/api/auth/impersonation/exit/route';

const mockUsers = new Map<string, User>();
jest.mock('@/services/auth', () => {
  const actual = jest.requireActual('@/services/auth/auth.service');
  const repo = {
    findById: async (id: string) => mockUsers.get(id) ?? null,
    findByEmail: async (email: string) => [...mockUsers.values()].find((u) => u.email === email) ?? null,
  };
  return { ...actual, authService: new actual.AuthService(repo, { jwtSecret: 'x'.repeat(32), jwtExpiresIn: '1h' }) };
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

/** A browser cookie jar, reduced to names: applies each Set-Cookie and returns the `Cookie` header to send next. */
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
    header: () => [...cookies].map(([n, c]) => `${n}=${c.value}`).join('; '),
  };
}

const post = (path: string, cookie: string) =>
  new NextRequest(`http://localhost:3001${path}`, { method: 'POST', headers: { cookie } });

beforeEach(async () => {
  const bcrypt = await import('bcryptjs');
  const passwordHash = await bcrypt.hash('pass-word-123', 4);
  mockUsers.clear();
  mockUsers.set('admin', makeUser({ id: 'admin', email: 'admin@entri.me', role: 'CONTRIBUTOR', passwordHash }));
  mockUsers.set('u1', makeUser({ passwordHash }));
});

describe('view as user: cookies from start to exit', () => {
  it('keeps the session and the site-view cookie naming the same user at every step', async () => {
    const browser = jar();
    const { tokens } = await auth.login({ email: 'admin@entri.me', password: 'pass-word-123' });
    browser.set('auth-token', tokens.accessToken);
    browser.set('site-view', await auth.siteTokenFor(tokens.accessToken));

    const started = await start(post('/api/admin/users/u1/impersonate', browser.header()), { params: Promise.resolve({ userId: 'u1' }) });
    expect(started.status).toBe(200);
    browser.apply(started);
    await expect(auth.verifySession(browser.get('auth-token')!.value)).resolves.toMatchObject({ userId: 'u1', impersonatorId: 'admin' });
    await expect(auth.verifySiteSession(browser.get('site-view')!.value)).resolves.toMatchObject({ userId: 'u1', impersonatorId: 'admin' });
    expect(browser.get('admin-restore')).toEqual({ value: tokens.accessToken, path: '/api/auth/impersonation/exit' });

    const exited = await exit(post('/api/auth/impersonation/exit', browser.header()));
    expect(exited.status).toBe(200);
    browser.apply(exited);
    await expect(auth.verifySession(browser.get('auth-token')!.value)).resolves.toEqual(
      expect.objectContaining({ userId: 'admin', role: 'CONTRIBUTOR' }),
    );
    expect((await auth.verifySession(browser.get('auth-token')!.value)).impersonatorId).toBeUndefined();
    await expect(auth.verifySiteSession(browser.get('site-view')!.value)).resolves.toMatchObject({ userId: 'admin' });
    expect(browser.get('admin-restore')).toBeUndefined();
  });

  it('signs out of both cookies when the restore cookie belongs to a different admin than the view', async () => {
    mockUsers.set('other', makeUser({ id: 'other', email: 'other@entri.me', role: 'CONTRIBUTOR' }));
    const { accessToken: othersView } = await auth.impersonate('other', 'u1');
    const { tokens } = await auth.login({ email: 'admin@entri.me', password: 'pass-word-123' });
    const res = await exit(post('/api/auth/impersonation/exit', `auth-token=${othersView}; admin-restore=${tokens.accessToken}`));
    expect(res.status).toBe(401);
    expect(res.headers.getSetCookie().map((c) => c.split('=')[0])).toEqual(['auth-token', 'site-view', 'admin-restore']);
  });
});
