jest.mock('@/lib/docker-ops', () => ({ dockerOps: {}, containerNameFor: jest.fn() }));
jest.mock('@/services/deployment', () => ({ deploymentService: {} }));
// The real module reads env config on import; only its bcrypt cost is needed here.
jest.mock('@/services/auth/auth.service', () => ({ SALT_ROUNDS: 4 }));
const mockCountUsers = jest.fn();
const mockTx = { $executeRaw: jest.fn(), user: { count: mockCountUsers, findUnique: jest.fn() } };
jest.mock('@/lib/prisma', () => ({
  prisma: { $transaction: (fn: (tx: typeof mockTx) => unknown) => fn(mockTx) },
}));

import { AdminService } from '@/services/admin/admin.service';
import type { IUserRepository } from '@/repositories/user.repository';
import type { IProjectRepository } from '@/repositories/project.repository';
import type { IDockerOps } from '@/lib/docker-ops';
import type { IAdminActionRepository } from '@/repositories/admin-action.repository';

function setup(role: 'USER' | 'CONTRIBUTOR') {
  const target = { id: 'u1', email: 'dev@entri.me', role, suspendedAt: null };
  mockTx.user.findUnique.mockResolvedValue({ role });
  const userRepo = {
    findById: jest.fn(async (id: string) => (id === 'u1' ? target : { id, email: 'admin@entri.me' })),
    setSuspended: jest.fn(async () => ({ ...target, suspendedAt: new Date() })),
    revokeSessions: jest.fn(async () => undefined),
  };
  const adminActions = { create: jest.fn(async () => ({})) };
  const service = new AdminService(
    userRepo as unknown as IUserRepository,
    {} as IProjectRepository,
    {} as IDockerOps,
    adminActions as unknown as IAdminActionRepository,
  );
  return { service, userRepo, adminActions };
}

describe('AdminService.setUserSuspended', () => {
  beforeEach(() => mockCountUsers.mockReset());

  it('suspends a user and records who did it', async () => {
    const { service, userRepo, adminActions } = setup('USER');
    await service.setUserSuspended('u1', true, 'admin');
    expect(userRepo.setSuspended).toHaveBeenCalledWith('u1', true, mockTx);
    expect(adminActions.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'USER_SUSPENDED', actorEmail: 'admin@entri.me', targetLabel: 'dev@entri.me' }),
    );
  });

  it('refuses to let an admin suspend themselves', async () => {
    const { service, userRepo } = setup('CONTRIBUTOR');
    await expect(service.setUserSuspended('u1', true, 'u1')).rejects.toThrow(/your own account/);
    expect(userRepo.setSuspended).not.toHaveBeenCalled();
  });

  it('refuses to suspend the last active contributor', async () => {
    const { service, userRepo } = setup('CONTRIBUTOR');
    mockCountUsers.mockResolvedValue(0);
    await expect(service.setUserSuspended('u1', true, 'admin')).rejects.toThrow(/last active CONTRIBUTOR/);
    expect(mockCountUsers).toHaveBeenCalledWith({
      where: { role: 'CONTRIBUTOR', suspendedAt: null, id: { not: 'u1' } },
    });
    expect(userRepo.setSuspended).not.toHaveBeenCalled();
  });
});

describe('AdminService.signOutEverywhere', () => {
  it('revokes the sessions and records the action', async () => {
    const { service, userRepo, adminActions } = setup('USER');
    await service.signOutEverywhere('u1', 'admin');
    expect(userRepo.revokeSessions).toHaveBeenCalledWith('u1');
    expect(adminActions.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'USER_SIGNED_OUT' }));
  });
});
