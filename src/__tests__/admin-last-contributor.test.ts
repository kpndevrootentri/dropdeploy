jest.mock('@/lib/docker-ops', () => ({ dockerOps: {}, containerNameFor: jest.fn() }));
jest.mock('@/services/deployment', () => ({ deploymentService: {} }));
// The real module reads env config on import; only its bcrypt cost is needed here.
jest.mock('@/services/auth/auth.service', () => ({ SALT_ROUNDS: 4 }));

// Each step logs its name, flagged when it ran outside the $transaction callback.
const mockSteps: string[] = [];
let mockInTx = false;
let mockOtherActive = 1;
let mockRoleUnderLock = 'CONTRIBUTOR';
let mockPrecheckOthers = 1;
const step = (name: string): void => {
  mockSteps.push(mockInTx ? name : `${name} (outside tx)`);
};
const mockTx = {
  $executeRaw: jest.fn(async (sql: TemplateStringsArray) => {
    step(/^SELECT pg_advisory_xact_lock\(\d+\)$/.test(sql.join('')) ? 'lock' : 'other sql');
  }),
  user: {
    findUnique: jest.fn(async () => {
      step('read role');
      return { role: mockRoleUnderLock };
    }),
    count: jest.fn(async () => {
      step('count');
      return mockOtherActive;
    }),
  },
};
// deleteUser's check before its container cleanup, outside the transaction.
const mockPrecheckCount = jest.fn(async () => {
  step('pre-check');
  return mockPrecheckOthers;
});
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { count: () => mockPrecheckCount() },
    $transaction: async (fn: (tx: typeof mockTx) => Promise<unknown>) => {
      mockInTx = true;
      try {
        return await fn(mockTx);
      } finally {
        mockInTx = false;
      }
    },
  },
}));

import { AdminService } from '@/services/admin/admin.service';
import type { IUserRepository } from '@/repositories/user.repository';
import type { IProjectRepository } from '@/repositories/project.repository';
import type { IDockerOps } from '@/lib/docker-ops';
import type { IDeploymentRepository } from '@/repositories/deployment.repository';
import type { IAdminActionRepository } from '@/repositories/admin-action.repository';

function setup(roleBeforeLock: 'USER' | 'CONTRIBUTOR' = 'CONTRIBUTOR') {
  const target = { id: 'u1', email: 'dev@entri.me', role: roleBeforeLock, suspendedAt: null };
  const write = (name: string) => jest.fn(async () => {
    step(name);
    return target;
  });
  const userRepo = {
    findById: jest.fn(async (id: string) => (id === 'u1' ? target : { id, email: 'admin@entri.me' })),
    updateRole: write('write'),
    setSuspended: write('write'),
    delete: write('write'),
  };
  const adminActions = { create: jest.fn(async () => step('audit')) };
  const docker = { removeProjectResources: jest.fn(async () => undefined) };
  const service = new AdminService(
    userRepo as unknown as IUserRepository,
    { findByUserId: jest.fn(async () => []) } as unknown as IProjectRepository,
    docker as unknown as IDockerOps,
    {} as IDeploymentRepository,
    adminActions as unknown as IAdminActionRepository,
  );
  return { service, userRepo, adminActions, docker };
}

const mutations = [
  {
    name: 'changeUserRole (demote)',
    run: (s: AdminService) => s.changeUserRole('u1', 'USER', 'admin'),
    write: 'updateRole' as const,
    args: ['u1', 'USER'],
    refusal: 'Cannot remove the last CONTRIBUTOR',
    before: [] as string[],
  },
  {
    name: 'setUserSuspended',
    run: (s: AdminService) => s.setUserSuspended('u1', true, 'admin'),
    write: 'setSuspended' as const,
    args: ['u1', true],
    refusal: 'Cannot suspend the last active CONTRIBUTOR',
    before: [] as string[],
  },
  {
    name: 'deleteUser',
    run: (s: AdminService) => s.deleteUser('u1', 'admin'),
    write: 'delete' as const,
    args: ['u1'],
    refusal: 'Cannot delete the last CONTRIBUTOR',
    before: ['pre-check (outside tx)'],
  },
];

describe('AdminService last-active-CONTRIBUTOR rule', () => {
  beforeEach(() => {
    mockSteps.length = 0;
    mockOtherActive = 1;
    mockRoleUnderLock = 'CONTRIBUTOR';
    mockPrecheckOthers = 1;
    mockTx.user.count.mockClear();
  });

  it.each(mutations)('$name takes the lock, then counts and writes in one transaction, and audits after', async (m) => {
    const { service, userRepo } = setup();
    await m.run(service);
    expect(mockSteps).toEqual([...m.before, 'lock', 'read role', 'count', 'write', 'audit (outside tx)']);
    expect(mockTx.user.count).toHaveBeenCalledWith({
      where: { role: 'CONTRIBUTOR', suspendedAt: null, id: { not: 'u1' } },
    });
    expect(userRepo[m.write]).toHaveBeenCalledWith(...m.args, mockTx);
  });

  it.each(mutations)('$name still refuses the last active CONTRIBUTOR', async (m) => {
    mockOtherActive = 0;
    const { service, userRepo, adminActions } = setup();
    await expect(m.run(service)).rejects.toThrow(m.refusal);
    expect(mockSteps).toEqual([...m.before, 'lock', 'read role', 'count']);
    expect(userRepo[m.write]).not.toHaveBeenCalled();
    expect(adminActions.create).not.toHaveBeenCalled();
  });

  it('decides on the role read under the lock, not the one read before it', async () => {
    mockOtherActive = 0;
    const { service, userRepo } = setup('USER');
    await expect(service.setUserSuspended('u1', true, 'admin')).rejects.toThrow('last active CONTRIBUTOR');
    expect(userRepo.setSuspended).not.toHaveBeenCalled();
  });

  it('deleteUser refuses before removing any container when no other active CONTRIBUTOR exists', async () => {
    mockPrecheckOthers = 0;
    const { service, userRepo, docker } = setup();
    await expect(service.deleteUser('u1', 'admin')).rejects.toThrow('Cannot delete the last CONTRIBUTOR');
    expect(mockSteps).toEqual(['pre-check (outside tx)']);
    expect(docker.removeProjectResources).not.toHaveBeenCalled();
    expect(userRepo.delete).not.toHaveBeenCalled();
  });

  it('writes without counting when the user is not a CONTRIBUTOR under the lock', async () => {
    mockRoleUnderLock = 'USER';
    const { service } = setup('USER');
    await service.deleteUser('u1', 'admin');
    expect(mockSteps).toEqual(['lock', 'read role', 'write', 'audit (outside tx)']);
  });
});
