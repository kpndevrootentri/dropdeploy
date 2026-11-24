type Row = Record<string, unknown>;

/** Just enough of Postgres for CohortRepository.addStudents: unique emails and one row per person per batch. */
const mockDb: { users: Row[]; invites: Row[]; members: Row[] } = { users: [], invites: [], members: [] };

type MemberWhere = { cohortId: string; userId: { in: string[] }; endedAt?: { not: null } };
const mockMemberMatches = (m: Row, where: MemberWhere): boolean =>
  m.cohortId === where.cohortId && where.userId.in.includes(m.userId as string) && (!where.endedAt || m.endedAt !== null);

// Only the transaction client has models, so a write outside the transaction would throw.
const mockTx = {
  user: {
    createManyAndReturn: async ({ data }: { data: Row[] }) => {
      const fresh = data.filter((d) => !mockDb.users.some((u) => u.email === d.email)).map((d): Row => ({ id: `id-${d.email}`, ...d }));
      mockDb.users.push(...fresh);
      return fresh.map((u) => ({ id: u.id, email: u.email }));
    },
  },
  inviteToken: {
    createMany: async ({ data }: { data: Row[] }) => {
      mockDb.invites.push(...data);
      return { count: data.length };
    },
  },
  cohortMember: {
    createManyAndReturn: async ({ data }: { data: Row[] }) => {
      const fresh = data.filter((d) => !mockDb.members.some((m) => m.cohortId === d.cohortId && m.userId === d.userId));
      mockDb.members.push(...fresh.map((d) => ({ endedAt: null, ...d })));
      return fresh.map((d) => ({ userId: d.userId }));
    },
    findMany: async ({ where }: { where: MemberWhere }) =>
      mockDb.members.filter((m) => mockMemberMatches(m, where)).map((m) => ({ userId: m.userId })),
    updateMany: async ({ where, data }: { where: MemberWhere; data: Row }) => {
      const rows = mockDb.members.filter((m) => mockMemberMatches(m, where));
      rows.forEach((m) => Object.assign(m, data));
      return { count: rows.length };
    },
  },
};
const mockTransaction = jest.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx));

jest.mock('@/lib/prisma', () => ({ prisma: { $transaction: (fn: (tx: unknown) => Promise<unknown>) => mockTransaction(fn) } }));

import { cohortRepository } from '@/repositories/cohort.repository';

const QUOTAS = { projectQuota: 5, domainQuota: 1 };
const write = (existingUserIds: string[], invites: { email: string; tokenHash: string; expiresAt: Date }[] = []) =>
  cohortRepository.addStudents('c1', { existingUserIds, invites, passwordHash: 'hash', quotas: QUOTAS });
const member = (userId: string) => mockDb.members.find((m) => m.userId === userId);

beforeEach(() => {
  mockTransaction.mockClear();
  mockDb.users = [{ id: 'taken', email: 'taken@entri.me' }];
  mockDb.invites = [];
  mockDb.members = [
    { cohortId: 'c1', userId: 'mentor', role: 'MENTOR', endedAt: null },
    { cohortId: 'c1', userId: 'left', role: 'MENTOR', endedAt: new Date('2027-01-01') },
  ];
});

describe('CohortRepository.addStudents', () => {
  it('never turns an active mentor into a student, brings back an ended row as a student, and adds a new one', async () => {
    await write(['mentor', 'left', 'new']);
    expect(member('mentor')).toMatchObject({ role: 'MENTOR', endedAt: null });
    expect(member('left')).toMatchObject({ role: 'STUDENT', endedAt: null });
    expect(member('new')).toMatchObject({ cohortId: 'c1', role: 'STUDENT', endedAt: null });
  });

  it('returns only the people it actually added or brought back, never one it left alone', async () => {
    const { addedUserIds } = await write(['mentor', 'left', 'new']);
    expect(addedUserIds.sort()).toEqual(['left', 'new']);
  });

  it('creates invited accounts, their invites and their memberships in one transaction', async () => {
    const expiresAt = new Date('2027-01-08');
    const { created, addedUserIds } = await write([], [
      { email: 'new@entri.me', tokenHash: 'h-new', expiresAt },
      { email: 'taken@entri.me', tokenHash: 'h-taken', expiresAt },
    ]);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    // Someone else registered taken@ meanwhile: not returned, not given an invite, not added.
    expect(created).toEqual([{ id: 'id-new@entri.me', email: 'new@entri.me' }]);
    expect(addedUserIds).toEqual(['id-new@entri.me']);
    expect(mockDb.users).toContainEqual(expect.objectContaining({ email: 'new@entri.me', passwordHash: 'hash', mustResetPassword: true, ...QUOTAS }));
    expect(mockDb.invites).toEqual([{ userId: 'id-new@entri.me', tokenHash: 'h-new', expiresAt }]);
    expect(member('id-new@entri.me')).toMatchObject({ role: 'STUDENT' });
    expect(member('taken')).toBeUndefined();
  });
});
