jest.mock('@/lib/docker-ops', () => ({ dockerOps: {}, containerNameFor: jest.fn() }));
jest.mock('@/services/deployment', () => ({ deploymentService: {} }));

import { AdminService } from '@/services/admin/admin.service';
import type { IUserRepository } from '@/repositories/user.repository';
import type { IProjectRepository } from '@/repositories/project.repository';
import type { IDockerOps } from '@/lib/docker-ops';

function setup(registered: string[]) {
  const userRepo = {
    createMany: jest.fn(async (emails: string[]) => emails.filter((e) => !registered.includes(e))),
  };
  const service = new AdminService(userRepo as unknown as IUserRepository, {} as IProjectRepository, {} as IDockerOps);
  return { service, userRepo };
}

describe('AdminService.bulkCreateUsers', () => {
  it('creates new emails once, skips registered ones and reports invalid ones', async () => {
    const { service, userRepo } = setup(['old@entri.me']);
    const result = await service.bulkCreateUsers(
      [' New@Entri.me ', 'new@entri.me', 'old@entri.me', 'not-an-email', ''],
      'password',
    );
    expect(userRepo.createMany).toHaveBeenCalledWith(['new@entri.me', 'old@entri.me'], expect.any(String));
    expect(result).toEqual({ created: ['new@entri.me'], skipped: ['old@entri.me'], invalid: ['not-an-email'] });
  });

  it('rejects a short password before touching the database', async () => {
    const { service, userRepo } = setup([]);
    await expect(service.bulkCreateUsers(['a@entri.me'], 'short')).rejects.toThrow('at least 8');
    expect(userRepo.createMany).not.toHaveBeenCalled();
  });
});
