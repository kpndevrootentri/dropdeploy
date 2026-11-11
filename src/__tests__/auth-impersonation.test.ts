import type { User } from '@prisma/client';
import { AuthService, IMPERSONATION_TTL_SECONDS } from '@/services/auth/auth.service';
import type { IUserRepository } from '@/repositories/user.repository';

function makeUser(overrides: Partial<User>): User {
  return {
    id: 'u1',
    email: 'dev@entri.me',
    passwordHash: '',
    role: 'USER',
    mustResetPassword: false,
    tokenVersion: 0,
    projectQuota: 5,
    domainQuota: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as User;
}

describe('AuthService view-as-user sessions', () => {
  let users: Map<string, User>;
  const repo = { findById: async (id: string) => users.get(id) ?? null } as unknown as IUserRepository;
  const auth = new AuthService(repo, { jwtSecret: 'x'.repeat(32), jwtExpiresIn: '7d' });

  beforeEach(() => {
    users = new Map([
      ['admin', makeUser({ id: 'admin', email: 'admin@entri.me', role: 'CONTRIBUTOR' })],
      ['other-admin', makeUser({ id: 'other-admin', email: 'boss@entri.me', role: 'CONTRIBUTOR' })],
      ['u1', makeUser({ id: 'u1', email: 'dev@entri.me', mustResetPassword: true })],
    ]);
  });

  afterEach(() => jest.useRealTimers());

  it('signs a session as the user that names the admin and is never stuck on a password reset', async () => {
    const { accessToken } = await auth.impersonate('admin', 'u1');
    await expect(auth.verifySession(accessToken)).resolves.toEqual({
      userId: 'u1',
      email: 'dev@entri.me',
      role: 'USER',
      mustResetPassword: false,
      impersonatorId: 'admin',
    });
  });

  it('refuses to view as another admin, or as yourself', async () => {
    await expect(auth.impersonate('admin', 'other-admin')).rejects.toThrow(/another admin/);
    await expect(auth.impersonate('admin', 'admin')).rejects.toThrow(/yourself/);
  });

  it('refuses a non-admin', async () => {
    await expect(auth.impersonate('u1', 'admin')).rejects.toThrow(/Contributor/);
  });

  it(`expires after ${IMPERSONATION_TTL_SECONDS / 60} minutes`, async () => {
    const { accessToken } = await auth.impersonate('admin', 'u1');
    jest.useFakeTimers({ now: Date.now() + (IMPERSONATION_TTL_SECONDS + 1) * 1000 });
    await expect(auth.verifySession(accessToken)).rejects.toThrow();
  });

  it('ends when the admin is demoted or signed out everywhere', async () => {
    const { accessToken } = await auth.impersonate('admin', 'u1');
    users.set('admin', { ...users.get('admin')!, tokenVersion: 1 });
    await expect(auth.verifySession(accessToken)).rejects.toThrow(/revoked/);

    users.set('admin', { ...users.get('admin')!, tokenVersion: 0, role: 'USER' });
    await expect(auth.verifySession(accessToken)).rejects.toThrow(/revoked/);
  });

  it('ends when the user is promoted to admin', async () => {
    const { accessToken } = await auth.impersonate('admin', 'u1');
    users.set('u1', { ...users.get('u1')!, role: 'CONTRIBUTOR' });
    await expect(auth.verifySession(accessToken)).rejects.toThrow(/revoked/);
  });
});
