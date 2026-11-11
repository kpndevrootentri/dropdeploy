import * as bcrypt from 'bcryptjs';

type Row = Record<string, unknown>;

/** Just enough of Postgres for the user and invite repositories: rows, equality, null and `gt`. */
const mockDb: { users: Row[]; invites: Row[] } = { users: [], invites: [] };

function mockMatches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, want]) =>
    want !== null && typeof want === 'object' && 'gt' in want
      ? (row[key] as Date) > (want as { gt: Date }).gt
      : row[key] === want,
  );
}

jest.mock('@/lib/docker-ops', () => ({ dockerOps: {}, containerNameFor: jest.fn() }));
jest.mock('@/services/deployment', () => ({ deploymentService: {} }));
jest.mock('@/lib/prisma', () => {
  const prisma = {
    user: {
      findUnique: async ({ where }: { where: Row }) => mockDb.users.find((u) => mockMatches(u, where)) ?? null,
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const user = mockDb.users.find((u) => mockMatches(u, where))!;
        Object.assign(user, data, { tokenVersion: (user.tokenVersion as number) + 1 });
        return { ...user };
      },
    },
    inviteToken: {
      create: async ({ data }: { data: Row }) => { mockDb.invites.push({ usedAt: null, ...data }); },
      findUnique: async ({ where }: { where: Row }) => mockDb.invites.find((i) => mockMatches(i, where)) ?? null,
      findFirst: async ({ where }: { where: Row }) => mockDb.invites.find((i) => mockMatches(i, where)) ?? null,
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const rows = mockDb.invites.filter((i) => mockMatches(i, where));
        rows.forEach((i) => Object.assign(i, data));
        return { count: rows.length };
      },
      deleteMany: async ({ where }: { where: Row }) => {
        const before = mockDb.invites.length;
        mockDb.invites = mockDb.invites.filter((i) => !mockMatches(i, where));
        return { count: before - mockDb.invites.length };
      },
    },
    $transaction: async (ops: unknown) =>
      Array.isArray(ops) ? Promise.all(ops) : (ops as (tx: unknown) => Promise<unknown>)(prisma),
  };
  return { prisma };
});

import { inviteService, INVALID_INVITE_MESSAGE } from '@/services/invite/invite.service';
import { adminService } from '@/services/admin/admin.service';
import { AuthService } from '@/services/auth/auth.service';
import { userRepository } from '@/repositories/user.repository';

const authService = new AuthService(userRepository, { jwtSecret: 'x'.repeat(32), jwtExpiresIn: '1h' });

beforeEach(() => {
  mockDb.invites = [];
  mockDb.users = [{
    id: 'u1',
    email: 'dev@entri.me',
    role: 'USER',
    passwordHash: bcrypt.hashSync('old-password', 4),
    mustResetPassword: true,
    tokenVersion: 0,
  }];
});

describe('invite links are revoked by any password change', () => {
  it('rejects an unused link after an admin generates a password', async () => {
    const link = await inviteService.issue('u1');
    await adminService.resetUserPassword('u1', undefined, 'admin');
    await expect(inviteService.accept(link, 'wrong-recipient')).rejects.toThrow(INVALID_INVITE_MESSAGE);
  });

  it("rejects an unused link after the user changes their own password", async () => {
    const link = await inviteService.issue('u1');
    await authService.changePassword('u1', 'old-password', 'my-own-password');
    await expect(inviteService.accept(link, 'wrong-recipient')).rejects.toThrow(INVALID_INVITE_MESSAGE);
    expect(await bcrypt.compare('my-own-password', mockDb.users[0].passwordHash as string)).toBe(true);
  });

  it('still accepts a link, and keeps it as used rather than deleting it', async () => {
    const link = await inviteService.issue('u1');
    await inviteService.accept(link, 'chosen-password');
    expect(mockDb.users[0].mustResetPassword).toBe(false);
    expect(mockDb.invites).toEqual([expect.objectContaining({ userId: 'u1', usedAt: expect.any(Date) })]);
  });
});
