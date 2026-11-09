jest.mock('@/lib/docker-ops', () => ({ dockerOps: {}, containerNameFor: (slug: string) => `dropdeploy-${slug}` }));
jest.mock('@/services/deployment', () => ({ deploymentService: {} }));
jest.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: jest.fn(async (ops: unknown[]) => ops),
    deployment: {
      updateMany: jest.fn((args: unknown) => ({ deploymentUpdateMany: args })),
      update: jest.fn((args: unknown) => ({ deploymentUpdate: args })),
    },
    project: { update: jest.fn((args: unknown) => ({ projectUpdate: args })) },
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
/* eslint-enable @typescript-eslint/no-require-imports */
import type { IUserRepository } from '@/repositories/user.repository';
import type { IProjectRepository } from '@/repositories/project.repository';
import type { IDockerOps } from '@/lib/docker-ops';

function setup(container: object | null = { running: true }) {
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
  const service = new AdminService(
    {} as IUserRepository,
    projectRepo as unknown as IProjectRepository,
    docker as unknown as IDockerOps,
  );
  return { service, projectRepo, docker, calls };
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

  it('restart clears stoppedAt after the container restarts', async () => {
    const { service, projectRepo, calls } = setup();
    await service.restartContainer('p1');
    expect(projectRepo.setStoppedAt).toHaveBeenCalledWith('p1', null);
    expect(calls).toEqual(['restart', 'clearStopped']);
  });

  it('a deployment going live clears stoppedAt in the same transaction', async () => {
    await new DeploymentRepository().activate('d2', 'p1', 'shop', { containerPort: 3005 });
    const ops = (prisma.$transaction as jest.Mock).mock.calls[0][0] as unknown[];
    expect(ops).toContainEqual({ projectUpdate: { where: { id: 'p1' }, data: { stoppedAt: null } } });
  });
});
