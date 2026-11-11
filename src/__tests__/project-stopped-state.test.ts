jest.mock('@/lib/docker-ops', () => ({ dockerOps: {}, containerNameFor: (slug: string) => `dropdeploy-${slug}` }));
jest.mock('@/services/deployment', () => ({ deploymentService: {} }));
jest.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: jest.fn(async (ops: unknown[]) => ops),
    deployment: {
      updateMany: jest.fn((args: unknown) => ({ deploymentUpdateMany: args })),
      update: jest.fn((args: unknown) => ({ deploymentUpdate: args })),
    },
    project: { updateMany: jest.fn((args: unknown) => ({ projectUpdateMany: args })) },
  },
}));

Object.assign(process.env, {
  DATABASE_URL: 'postgresql://x@localhost/x',
  JWT_SECRET: 'x'.repeat(32),
  ENV_ENCRYPTION_KEY: '0'.repeat(64),
  BASE_DOMAIN: 'app.test',
  NEXT_PUBLIC_BASE_DOMAIN: 'app.test',
});

/* eslint-disable @typescript-eslint/no-require-imports */
const { AdminService } = require('@/services/admin/admin.service');
const { DeploymentRepository } = require('@/repositories/deployment.repository');
const { prisma } = require('@/lib/prisma');
const { DockerService } = require('@/services/docker/docker.service');
/* eslint-enable @typescript-eslint/no-require-imports */
import type { IUserRepository } from '@/repositories/user.repository';
import type { IProjectRepository } from '@/repositories/project.repository';
import type { IDockerOps } from '@/lib/docker-ops';
import type { IDeploymentRepository } from '@/repositories/deployment.repository';
import type { IAdminActionRepository } from '@/repositories/admin-action.repository';

const LIVE_CONTAINER = { running: true, ports: [{ hostPort: 4001, containerPort: 3000 }] };

function setup(container: object | null = LIVE_CONTAINER, live: object | null = { containerPort: 4001 }) {
  const calls: string[] = [];
  const projectRepo = {
    findById: jest.fn(async () => ({ id: 'p1', slug: 'shop' })),
    setStoppedAt: jest.fn(async (_id: string, at: Date | null) => { calls.push(at ? 'setStopped' : 'clearStopped'); }),
  };
  const docker = {
    containerInfo: jest.fn(async () => container),
    stopContainer: jest.fn(async () => { calls.push('stop'); }),
    restartContainer: jest.fn(async () => { calls.push('restart'); }),
  };
  const deploymentRepo = {
    findBuildingDeployment: jest.fn(async () => null),
    findQueuedDeploymentForProject: jest.fn(async () => null),
    findLiveDeployment: jest.fn(async () => live),
  };
  const service = new AdminService(
    {} as IUserRepository,
    projectRepo as unknown as IProjectRepository,
    docker as unknown as IDockerOps,
    deploymentRepo as unknown as IDeploymentRepository,
    { create: jest.fn(async () => ({})) } as unknown as IAdminActionRepository,
  );
  return { service, projectRepo, docker, deploymentRepo, calls };
}

describe('Project.stoppedAt', () => {
  it('stop records stoppedAt only after the container has stopped', async () => {
    const { service, projectRepo, docker, calls } = setup();
    await service.stopContainer('p1');
    expect(docker.stopContainer).toHaveBeenCalledWith('dropdeploy-shop');
    expect(projectRepo.setStoppedAt).toHaveBeenCalledWith('p1', expect.any(Date));
    expect(calls).toEqual(['stop', 'setStopped']);
  });

  it('does not mark a project stopped when Docker fails to stop it', async () => {
    const { service, projectRepo, docker } = setup();
    docker.stopContainer.mockRejectedValueOnce(new Error('daemon unavailable'));
    await expect(service.stopContainer('p1')).rejects.toThrow('daemon unavailable');
    expect(projectRepo.setStoppedAt).not.toHaveBeenCalled();
  });

  it('refuses to stop a project with no container, e.g. a static site', async () => {
    const { service, projectRepo, docker } = setup(null);
    await expect(service.stopContainer('p1')).rejects.toThrow('no container to stop');
    expect(docker.stopContainer).not.toHaveBeenCalled();
    expect(projectRepo.setStoppedAt).not.toHaveBeenCalled();
  });

  it.each([
    ['the old container while a new deployment takes over', { containerPort: 4002 }],
    ['a container left over after a switch to static hosting', { containerPort: null }],
  ])('refuses to stop %s', async (_label, live) => {
    const { service, projectRepo, docker } = setup(LIVE_CONTAINER, live);
    await expect(service.stopContainer('p1')).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(docker.stopContainer).not.toHaveBeenCalled();
    expect(projectRepo.setStoppedAt).not.toHaveBeenCalled();
  });

  it.each(['findBuildingDeployment', 'findQueuedDeploymentForProject'] as const)(
    'refuses to stop while a deployment is in progress (%s)',
    async (finder) => {
      const { service, projectRepo, docker, deploymentRepo } = setup();
      (deploymentRepo[finder] as jest.Mock).mockResolvedValueOnce({ id: 'd2' });
      await expect(service.stopContainer('p1')).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(docker.stopContainer).not.toHaveBeenCalled();
      expect(projectRepo.setStoppedAt).not.toHaveBeenCalled();
    },
  );

  it('restart clears stoppedAt after the container restarts', async () => {
    const { service, projectRepo, calls } = setup();
    await service.restartContainer('p1');
    expect(projectRepo.setStoppedAt).toHaveBeenCalledWith('p1', null);
    expect(calls).toEqual(['restart', 'clearStopped']);
  });

  it('a deployment going live clears stoppedAt in the same transaction', async () => {
    await new DeploymentRepository().activate('d2', 'p1', 'shop', { containerPort: 3005 });
    const ops = (prisma.$transaction as jest.Mock).mock.calls[0][0] as unknown[];
    expect(ops).toContainEqual({
      projectUpdateMany: { where: { id: 'p1', stoppedAt: { not: null } }, data: { stoppedAt: null } },
    });
  });
});

describe('DockerService.getContainerInfo', () => {
  function withInspectError(err: object) {
    const svc = new DockerService({ socketPath: '/nonexistent.sock' });
    svc.docker = { getContainer: () => ({ inspect: async () => { throw err; } }) };
    return svc;
  }

  it('returns null for a missing container', async () => {
    await expect(withInspectError({ statusCode: 404 }).getContainerInfo('dropdeploy-shop')).resolves.toBeNull();
  });

  it('rethrows other Docker errors, e.g. a down daemon', async () => {
    const down = Object.assign(new Error('connect ENOENT /var/run/docker.sock'), { code: 'ENOENT' });
    await expect(withInspectError(down).getContainerInfo('dropdeploy-shop')).rejects.toBe(down);
  });
});
