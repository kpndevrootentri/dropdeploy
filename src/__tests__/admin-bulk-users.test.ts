jest.mock('@/lib/docker-ops', () => ({ dockerOps: {}, containerNameFor: jest.fn() }));
jest.mock('@/services/deployment', () => ({ deploymentService: {} }));

import { AdminService } from '@/services/admin/admin.service';
import type { IUserRepository } from '@/repositories/user.repository';
import type { IProjectRepository } from '@/repositories/project.repository';
import type { IDockerOps } from '@/lib/docker-ops';
import type { IAdminActionRepository } from '@/repositories/admin-action.repository';

function setup(registered: string[]) {
  const userRepo = {
    createMany: jest.fn(async (emails: string[]) => emails.filter((e) => !registered.includes(e))),
    findById: jest.fn(async () => ({ id: 'admin', email: 'admin@entri.me' })),
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

describe('AdminService.bulkCreateUsers', () => {
  it('creates new emails once, skips registered ones and reports invalid ones', async () => {
    const { service, userRepo } = setup(['old@entri.me']);
    const result = await service.bulkCreateUsers(
      [' New@Entri.me ', 'new@entri.me', 'old@entri.me', 'not-an-email', ''],
      'password',
      'admin',
    );
    expect(userRepo.createMany).toHaveBeenCalledWith(['new@entri.me', 'old@entri.me'], expect.any(String));
    expect(result).toEqual({ created: ['new@entri.me'], skipped: ['old@entri.me'], invalid: ['not-an-email'] });
  });

  it('records one audit entry naming the admin and the created emails, never the password', async () => {
    const { service, adminActions } = setup([]);
    await service.bulkCreateUsers(['a@entri.me'], 'temp-password-1', 'admin');
    expect(adminActions.create).toHaveBeenCalledTimes(1);
    const entry = (adminActions.create.mock.calls[0] as unknown[])[0];
    expect(entry).toMatchObject({ actorId: 'admin', actorEmail: 'admin@entri.me', action: 'USERS_BULK_CREATED' });
    expect(JSON.stringify(entry)).not.toContain('temp-password-1');
  });

  it('rejects a short password before touching the database', async () => {
    const { service, userRepo } = setup([]);
    await expect(service.bulkCreateUsers(['a@entri.me'], 'short', 'admin')).rejects.toThrow('at least 8');
    expect(userRepo.createMany).not.toHaveBeenCalled();
  });
});
