import type { User } from '@prisma/client';
import { AuthService } from '@/services/auth/auth.service';
import type { IUserRepository } from '@/repositories/user.repository';

function makeUser(overrides: Partial<User> = {}): User {
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

describe('AuthService.verifySession', () => {
  let stored: User | null;
  const repo = {
    findById: async () => stored,
    findByEmail: async () => stored,
    setPassword: async (_id: string, passwordHash: string, mustResetPassword = false) => {
      stored = { ...stored!, passwordHash, mustResetPassword, tokenVersion: stored!.tokenVersion + 1 };
      return stored;
    },
  } as unknown as IUserRepository;
  const auth = new AuthService(repo, { jwtSecret: 'x'.repeat(32), jwtExpiresIn: '1h' });

  beforeEach(async () => {
    const bcrypt = await import('bcryptjs');
    stored = makeUser({ passwordHash: await bcrypt.hash('old-password', 4) });
  });

  it('accepts a current token and reads the role from the database', async () => {
    const { tokens } = await auth.login({ email: 'dev@entri.me', password: 'old-password' });
    stored = { ...stored!, role: 'CONTRIBUTOR' };
    expect((await auth.verifySession(tokens.accessToken)).role).toBe('CONTRIBUTOR');
  });

  it('revokes every earlier token when the password changes', async () => {
    const { tokens: stolen } = await auth.login({ email: 'dev@entri.me', password: 'old-password' });
    const fresh = await auth.changePassword('u1', 'old-password', 'new-password-123');

    await expect(auth.verifySession(stolen.accessToken)).rejects.toThrow(/revoked/);
    await expect(auth.verifySession(fresh.accessToken)).resolves.toMatchObject({ userId: 'u1' });
  });

  it('rejects the token of a deleted user', async () => {
    const { tokens } = await auth.login({ email: 'dev@entri.me', password: 'old-password' });
    stored = null;
    await expect(auth.verifySession(tokens.accessToken)).rejects.toThrow();
  });

  it('refuses a password change with the wrong current password', async () => {
    await expect(auth.changePassword('u1', 'wrong', 'new-password-123')).rejects.toThrow(/incorrect/);
  });
});
