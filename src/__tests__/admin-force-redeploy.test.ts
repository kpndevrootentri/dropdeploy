const mockCreateDeployment = jest.fn();
jest.mock('@/lib/docker-ops', () => ({ dockerOps: {}, containerNameFor: jest.fn() }));
jest.mock('@/services/deployment', () => ({ deploymentService: { createDeployment: mockCreateDeployment } }));
// The real module reads env config on import; only its bcrypt cost is needed here.
jest.mock('@/services/auth/auth.service', () => ({ SALT_ROUNDS: 4 }));
jest.mock('@/lib/prisma', () => ({ prisma: {} }));

import { AdminService } from '@/services/admin/admin.service';
import { ValidationError } from '@/lib/errors';
import type { IUserRepository } from '@/repositories/user.repository';
import type { IProjectRepository } from '@/repositories/project.repository';
import type { IDockerOps } from '@/lib/docker-ops';
import type { IDeploymentRepository } from '@/repositories/deployment.repository';
import type { IAdminActionRepository } from '@/repositories/admin-action.repository';

function setup(project: { source: string; githubUrl: string | null }) {
  const adminActions = { create: jest.fn(async () => ({})) };
  const service = new AdminService(
    { findById: jest.fn(async () => ({ id: 'admin', email: 'admin@entri.me' })) } as unknown as IUserRepository,
    { findById: jest.fn(async () => ({ id: 'p1', name: 'site', slug: 'site', userId: 'owner', ...project })) } as unknown as IProjectRepository,
    {} as IDockerOps,
    {} as IDeploymentRepository,
    adminActions as unknown as IAdminActionRepository,
  );
  return { service, adminActions };
}

describe('AdminService.forceRedeploy', () => {
  beforeEach(() => mockCreateDeployment.mockReset());

  it.each([
    ['an upload', { source: 'UPLOAD', githubUrl: null }, 'Upload — nothing to pull'],
    ['a repository project with no URL', { source: 'GITHUB', githubUrl: null }, 'No repository URL'],
  ])('refuses %s, which would only fail again', async (_label, project, message) => {
    const { service, adminActions } = setup(project);
    const result = service.forceRedeploy('p1', 'admin');
    await expect(result).rejects.toBeInstanceOf(ValidationError);
    await expect(result).rejects.toThrow(message);
    expect(mockCreateDeployment).not.toHaveBeenCalled();
    expect(adminActions.create).not.toHaveBeenCalled();
  });

  it('queues a new deployment as the owner and records who asked', async () => {
    const { service, adminActions } = setup({ source: 'GITHUB', githubUrl: 'https://github.com/a/b' });
    await service.forceRedeploy('p1', 'admin');
    expect(mockCreateDeployment).toHaveBeenCalledWith('p1', 'owner');
    expect(adminActions.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PROJECT_REDEPLOYED', actorId: 'admin', targetId: 'p1' }),
    );
  });
});
