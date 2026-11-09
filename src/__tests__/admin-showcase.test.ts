import type { ProjectShowcase } from '@prisma/client';
import { ShowcaseService } from '@/services/showcase/showcase.service';
import type { IShowcaseRepository } from '@/repositories/showcase.repository';
import type { IProjectRepository } from '@/repositories/project.repository';

function setup(current: Partial<ProjectShowcase> | null) {
  const repo = {
    findByProjectId: jest.fn(async () => current),
    setFlags: jest.fn(async () => ({}) as ProjectShowcase),
  };
  return { repo, service: new ShowcaseService(repo as unknown as IShowcaseRepository, {} as IProjectRepository) };
}

describe('ShowcaseService.adminSetFlags', () => {
  it('republishes an entry an admin unpublished', async () => {
    const { service, repo } = setup({ isPublished: false, publishedAt: new Date() });
    await service.adminSetFlags('p1', { isPublished: true });
    expect(repo.setFlags).toHaveBeenCalledWith('p1', { isPublished: true });
  });

  it("never publishes an owner's draft", async () => {
    const { service, repo } = setup({ isPublished: false, publishedAt: null });
    await expect(service.adminSetFlags('p1', { isPublished: true })).rejects.toThrow('Only the owner');
    expect(repo.setFlags).not.toHaveBeenCalled();
  });

  it('can still feature a draft and unpublish a live entry', async () => {
    await expect(setup({ isPublished: false, publishedAt: null }).service.adminSetFlags('p1', { featured: true })).resolves.toBeDefined();
    await expect(setup({ isPublished: true, publishedAt: new Date() }).service.adminSetFlags('p1', { isPublished: false })).resolves.toBeDefined();
  });

  it('reports a missing entry', async () => {
    await expect(setup(null).service.adminSetFlags('p1', { featured: true })).rejects.toThrow('Showcase not found');
  });
});
