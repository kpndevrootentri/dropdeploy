jest.mock('@/lib/docker-ops', () => ({ dockerOps: {}, containerNameFor: jest.fn() }));
jest.mock('@/services/deployment', () => ({ deploymentService: {} }));
// deleteUser's last-CONTRIBUTOR transaction. These users are plain USERs, so it only locks and writes.
jest.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ $executeRaw: async () => undefined, user: { findUnique: async () => ({ role: 'USER' }) } }),
  },
}));

import { AdminService } from '@/services/admin/admin.service';
import { AppError, ConflictError } from '@/lib/errors';
import type { IUserRepository } from '@/repositories/user.repository';
import type { IProjectRepository } from '@/repositories/project.repository';
import type { IDeploymentRepository } from '@/repositories/deployment.repository';
import type { IDockerOps } from '@/lib/docker-ops';
import type { IAdminActionRepository } from '@/repositories/admin-action.repository';

function setup({
  removeProjectResources = jest.fn(async () => undefined) as jest.Mock,
  building = [] as string[],
  queued = [] as string[],
} = {}) {
  const userRepo = {
    findById: jest.fn(async () => ({ id: 'u1', email: 'u1@entri.me', role: 'USER' })),
    delete: jest.fn(async () => undefined),
  };
  const projects = [{ id: 'p1', name: 'Site A', slug: 'site-a' }, { id: 'p2', name: 'Site B', slug: 'site-b' }];
  const projectRepo = {
    findByUserId: jest.fn(async () => projects),
    findById: jest.fn(async (id: string) => projects.find((p) => p.id === id) ?? null),
    delete: jest.fn(async () => undefined),
  };
  const deploymentRepo = {
    findBuildingDeployment: jest.fn(async (id: string) => (building.includes(id) ? { id: 'd1' } : null)),
    findQueuedDeploymentForProject: jest.fn(async (id: string) => (queued.includes(id) ? { id: 'd2' } : null)),
  };
  const docker = { removeProjectResources };
  const service = new AdminService(
    userRepo as unknown as IUserRepository,
    projectRepo as unknown as IProjectRepository,
    docker as unknown as IDockerOps,
    deploymentRepo as unknown as IDeploymentRepository,
    { create: jest.fn(async () => ({})) } as unknown as IAdminActionRepository,
  );
  return { service, userRepo, projectRepo, docker };
}

describe('AdminService.deleteUser', () => {
  it("removes every project's Docker resources before deleting the user", async () => {
    const { service, userRepo, docker } = setup();
    await service.deleteUser('u1', 'admin');
    expect(docker.removeProjectResources.mock.calls).toEqual([['site-a'], ['site-b']]);
    expect(userRepo.delete).toHaveBeenCalledWith('u1', expect.anything());
  });

  it('keeps the user when a container cannot be removed, so nothing is orphaned', async () => {
    const { service, userRepo } = setup({ removeProjectResources: jest.fn(async () => { throw new Error('docker down'); }) });
    await expect(service.deleteUser('u1', 'admin')).rejects.toThrow('docker down');
    expect(userRepo.delete).not.toHaveBeenCalled();
  });

  it('says a retry is safe when a later project fails after earlier ones were cleaned up', async () => {
    const removeProjectResources = jest.fn(async (slug: string) => {
      if (slug === 'site-b') throw new AppError('DOCKER_OPERATION_FAILED', 'The operation could not be completed.', 502);
    });
    const { service, userRepo } = setup({ removeProjectResources });
    const err = await service.deleteUser('u1', 'admin').catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'DOCKER_OPERATION_FAILED', statusCode: 502 });
    expect((err as Error).message).toMatch(/"Site B".*retrying is safe/);
    expect(userRepo.delete).not.toHaveBeenCalled();
  });

  it.each([
    ['BUILDING', { building: ['p2'] }],
    ['QUEUED', { queued: ['p2'] }],
  ])('refuses while a project has a %s deployment, before touching any container', async (_status, inFlight) => {
    const { service, userRepo, docker } = setup(inFlight);
    const err = await service.deleteUser('u1', 'admin').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as Error).message).toMatch(/"Site B" has a deploy in progress/);
    expect(docker.removeProjectResources).not.toHaveBeenCalled();
    expect(userRepo.delete).not.toHaveBeenCalled();
  });
});

describe('AdminService.deleteProject', () => {
  it('removes the Docker resources, then the project', async () => {
    const { service, projectRepo, docker } = setup();
    await service.deleteProject('p1', 'admin');
    expect(docker.removeProjectResources).toHaveBeenCalledWith('site-a');
    expect(projectRepo.delete).toHaveBeenCalledWith('p1');
  });

  it.each([
    ['BUILDING', { building: ['p1'] }],
    ['QUEUED', { queued: ['p1'] }],
  ])('refuses while the project has a %s deployment', async (_status, inFlight) => {
    const { service, projectRepo, docker } = setup(inFlight);
    await expect(service.deleteProject('p1', 'admin')).rejects.toBeInstanceOf(ConflictError);
    expect(docker.removeProjectResources).not.toHaveBeenCalled();
    expect(projectRepo.delete).not.toHaveBeenCalled();
  });
});
