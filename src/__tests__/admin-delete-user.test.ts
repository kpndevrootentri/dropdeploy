jest.mock('@/lib/docker-ops', () => ({ dockerOps: {}, containerNameFor: jest.fn() }));
jest.mock('@/services/deployment', () => ({ deploymentService: {} }));

import { AdminService } from '@/services/admin/admin.service';
import type { IUserRepository } from '@/repositories/user.repository';
import type { IProjectRepository } from '@/repositories/project.repository';
import type { IDockerOps } from '@/lib/docker-ops';

function setup(removeProjectResources = jest.fn(async () => undefined)) {
  const userRepo = {
    findById: jest.fn(async () => ({ id: 'u1', role: 'USER' })),
    delete: jest.fn(async () => undefined),
  };
  const projectRepo = { findByUserId: jest.fn(async () => [{ slug: 'site-a' }, { slug: 'site-b' }]) };
  const docker = { removeProjectResources };
  const service = new AdminService(
    userRepo as unknown as IUserRepository,
    projectRepo as unknown as IProjectRepository,
    docker as unknown as IDockerOps,
  );
  return { service, userRepo, docker };
}

describe('AdminService.deleteUser', () => {
  it("removes every project's Docker resources before deleting the user", async () => {
    const { service, userRepo, docker } = setup();
    await service.deleteUser('u1', 'admin');
    expect(docker.removeProjectResources.mock.calls).toEqual([['site-a'], ['site-b']]);
    expect(userRepo.delete).toHaveBeenCalledWith('u1');
  });

  it('keeps the user when a container cannot be removed, so nothing is orphaned', async () => {
    const { service, userRepo } = setup(jest.fn(async () => { throw new Error('docker down'); }));
    await expect(service.deleteUser('u1', 'admin')).rejects.toThrow('docker down');
    expect(userRepo.delete).not.toHaveBeenCalled();
  });
});
