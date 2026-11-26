import type { User } from '@prisma/client';
import { NextRequest } from 'next/server';
import { authService as auth } from '@/services/auth';
import { getSession } from '@/lib/get-session';

const mockUsers = new Map<string, User>();
jest.mock('@/services/auth', () => {
  const { AuthService } = jest.requireActual('@/services/auth/auth.service');
  const repo = {
    findById: async (id: string) => mockUsers.get(id) ?? null,
    findByEmail: async (email: string) => [...mockUsers.values()].find((u) => u.email === email) ?? null,
  };
  return { authService: new AuthService(repo, { jwtSecret: 'x'.repeat(32), jwtExpiresIn: '1h' }) };
});

function makeUser(overrides: Partial<User>): User {
  return {
    id: 'u1',
    email: 'dev@entri.me',
    passwordHash: '',
    role: 'USER',
    mustResetPassword: false,
    tokenVersion: 0,
    suspendedAt: null,
    projectQuota: 5,
    domainQuota: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as User;
}

async function signIn(email: string): Promise<{ session: string; site: string }> {
  const { tokens } = await auth.login({ email, password: 'pass-word-123' });
  return { session: tokens.accessToken, site: await auth.siteTokenFor(tokens.accessToken) };
}

const request = (headers: Record<string, string>): NextRequest =>
  new NextRequest('http://localhost:3001/api/projects', { headers });

beforeEach(async () => {
  const bcrypt = await import('bcryptjs');
  const passwordHash = await bcrypt.hash('pass-word-123', 4);
  mockUsers.clear();
  mockUsers.set('u1', makeUser({ passwordHash }));
  mockUsers.set('admin', makeUser({ id: 'admin', email: 'admin@entri.me', role: 'CONTRIBUTOR', passwordHash }));
});

describe('site-view tokens use their own key', () => {
  it('names the same user as the session it was made from', async () => {
    const { site } = await signIn('dev@entri.me');
    await expect(auth.verifySiteSession(site)).resolves.toEqual({
      userId: 'u1',
      email: 'dev@entri.me',
      role: 'USER',
      mustResetPassword: false,
    });
  });

  it('never passes as a dashboard session, and a session never passes as a site-view token', async () => {
    const { session, site } = await signIn('dev@entri.me');
    await expect(auth.verifySession(site)).rejects.toThrow(/Invalid or expired/);
    await expect(auth.verifyToken(site)).rejects.toThrow(/Invalid or expired/);
    await expect(auth.verifySiteSession(session)).rejects.toThrow(/Invalid or expired/);
  });

  it('cannot be minted from anything but a session token we signed', async () => {
    const { site } = await signIn('dev@entri.me');
    await expect(auth.siteTokenFor(site)).rejects.toThrow();
  });

  it('is refused as a Bearer token and as the session cookie', async () => {
    const { session, site } = await signIn('dev@entri.me');
    await expect(getSession(request({ authorization: `Bearer ${site}` }))).rejects.toMatchObject({ statusCode: 401 });
    await expect(getSession(request({ cookie: `auth-token=${site}` }))).rejects.toMatchObject({ statusCode: 401 });
    // The CLI's login JWT as Bearer keeps working.
    await expect(getSession(request({ authorization: `Bearer ${session}` }))).resolves.toMatchObject({ userId: 'u1', via: 'jwt' });
  });
});

describe('site-view tokens are revoked like sessions', () => {
  it('after the password changes (tokenVersion bumped)', async () => {
    const { site } = await signIn('dev@entri.me');
    mockUsers.set('u1', { ...mockUsers.get('u1')!, tokenVersion: 1 });
    await expect(auth.verifySiteSession(site)).rejects.toThrow(/revoked/);
  });

  it('for a deleted user', async () => {
    const { site } = await signIn('dev@entri.me');
    mockUsers.delete('u1');
    await expect(auth.verifySiteSession(site)).rejects.toThrow(/revoked/);
  });

  it('for a suspended user', async () => {
    const { site } = await signIn('dev@entri.me');
    mockUsers.set('u1', { ...mockUsers.get('u1')!, suspendedAt: new Date() });
    await expect(auth.verifySiteSession(site)).rejects.toThrow(/revoked/);
  });

  it('reports a pending password reset from the database, for the gate to refuse', async () => {
    const { site } = await signIn('dev@entri.me');
    mockUsers.set('u1', { ...mockUsers.get('u1')!, mustResetPassword: true });
    await expect(auth.verifySiteSession(site)).resolves.toMatchObject({ mustResetPassword: true });
  });

  it('for a view-as-user token, once the admin signs out everywhere', async () => {
    const { accessToken } = await auth.impersonate('admin', 'u1');
    const site = await auth.siteTokenFor(accessToken);
    await expect(auth.verifySiteSession(site)).resolves.toMatchObject({ userId: 'u1', impersonatorId: 'admin' });
    mockUsers.set('admin', { ...mockUsers.get('admin')!, tokenVersion: 1 });
    await expect(auth.verifySiteSession(site)).rejects.toThrow(/revoked/);
  });
});
