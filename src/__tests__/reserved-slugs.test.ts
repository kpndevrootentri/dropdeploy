const findUnique = jest.fn();

jest.mock('@/lib/prisma', () => ({
  prisma: {
    project: {
      findUnique: (...args: unknown[]) => findUnique(...args),
      create: ({ data }: { data: unknown }) => Promise.resolve(data),
    },
  },
}));

import { projectRepository } from '@/repositories/project.repository';

const base = { source: 'GITHUB' as const, githubUrl: 'https://github.com/a/b' };

describe('slugs that would take a platform Docker name', () => {
  beforeEach(() => findUnique.mockResolvedValue(null));

  // `caddy` would make the tenant container `dropdeploy-caddy`, the edge for every site.
  it.each(['Caddy', 'caddy!', ' caddy ', 'CADDY'])('%j does not get the slug caddy', async (name) => {
    const project = await projectRepository.create('u1', { ...base, name });
    expect(project.slug).toBe('caddy-1');
  });

  it('does not give out the tenant network name', async () => {
    const project = await projectRepository.create('u1', { ...base, name: 'Tenants' });
    expect(project.slug).toBe('tenants-1');
  });
});
