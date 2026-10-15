jest.mock('@/lib/docker-ops', () => ({ dockerOps: {} }));

import { ProjectService } from '@/services/project/project.service';
import type { IProjectRepository } from '@/repositories/project.repository';
import type { IUserRepository } from '@/repositories/user.repository';
import type { IDockerOps } from '@/lib/docker-ops';

function setup(existingType = 'NODEJS') {
  const projectRepo = {
    findByUserId: jest.fn().mockResolvedValue([]),
    findById: jest.fn().mockResolvedValue({ id: 'p1', userId: 'u1', type: existingType }),
    create: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue({}),
  };
  const userRepo = { findById: jest.fn().mockResolvedValue({ id: 'u1', projectQuota: 5 }) };
  const service = new ProjectService(
    projectRepo as unknown as IProjectRepository,
    {} as IDockerOps,
    userRepo as unknown as IUserRepository,
  );
  return { service, projectRepo };
}

const base = { name: 'blog', source: 'GITHUB' as const, githubUrl: 'https://github.com/a/b' };

describe('WordPress projects start private', () => {
  it('creates a WordPress project behind the private-URL gate', async () => {
    const { service, projectRepo } = setup();
    await service.create('u1', { ...base, type: 'WORDPRESS' });
    expect(projectRepo.create).toHaveBeenCalledWith('u1', expect.objectContaining({ isPrivate: true }));
  });

  it('leaves other project types public', async () => {
    const { service, projectRepo } = setup();
    await service.create('u1', { ...base, type: 'NODEJS' });
    expect(projectRepo.create).toHaveBeenCalledWith('u1', expect.objectContaining({ isPrivate: false }));
  });

  it('makes a project private when its type changes to WordPress', async () => {
    const { service, projectRepo } = setup('NODEJS');
    await service.update('p1', 'u1', { type: 'WORDPRESS' });
    expect(projectRepo.update).toHaveBeenCalledWith('p1', { type: 'WORDPRESS', isPrivate: true });
  });

  it('lets an installed WordPress site be made public', async () => {
    const { service, projectRepo } = setup('WORDPRESS');
    await service.update('p1', 'u1', { type: 'WORDPRESS', isPrivate: false });
    expect(projectRepo.update).toHaveBeenCalledWith('p1', { type: 'WORDPRESS', isPrivate: false });
  });
});
