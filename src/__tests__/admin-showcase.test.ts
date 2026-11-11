import type { ProjectShowcase } from '@prisma/client';
import { ShowcaseService } from '@/services/showcase/showcase.service';
import type { IShowcaseRepository } from '@/repositories/showcase.repository';
import type { IProjectRepository } from '@/repositories/project.repository';

type Flags = { isPublished?: boolean; featured?: boolean };

function setup(current: Partial<ProjectShowcase> | null) {
  const repo = {
    findByProjectId: jest.fn(async () => current),
    // Mirrors the repository's single-statement guard: publishing needs publishedAt set.
    setFlags: jest.fn(async (_id: string, flags: Flags) =>
      current && (!flags.isPublished || current.publishedAt) ? ({ ...current, ...flags } as ProjectShowcase) : null,
    ),
  };
  return { repo, service: new ShowcaseService(repo as unknown as IShowcaseRepository, {} as IProjectRepository) };
}

describe('ShowcaseService.adminSetFlags', () => {
  it('republishes an entry an admin unpublished', async () => {
    const { service, repo } = setup({ isPublished: false, publishedAt: new Date() });
    await expect(service.adminSetFlags('p1', { isPublished: true })).resolves.toMatchObject({ isPublished: true });
    expect(repo.setFlags).toHaveBeenCalledWith('p1', { isPublished: true });
  });

  it("never publishes an owner's draft, including one the owner unpublished since the admin's page loaded", async () => {
    const { service } = setup({ isPublished: false, publishedAt: null });
    await expect(service.adminSetFlags('p1', { isPublished: true })).rejects.toMatchObject({ statusCode: 409, message: 'Only the owner can publish a draft' });
  });

  it('can still feature a draft and unpublish a live entry', async () => {
    await expect(setup({ isPublished: false, publishedAt: null }).service.adminSetFlags('p1', { featured: true })).resolves.toBeDefined();
    await expect(setup({ isPublished: true, publishedAt: new Date() }).service.adminSetFlags('p1', { isPublished: false })).resolves.toBeDefined();
  });

  it('reports a missing entry', async () => {
    await expect(setup(null).service.adminSetFlags('p1', { featured: true })).rejects.toThrow('Showcase not found');
  });
});
