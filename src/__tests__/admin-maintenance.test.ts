jest.mock('@/services/project-access/project-access.service', () => ({ projectAccessService: {} }));

import { findOrphanContainers } from '@/lib/orphan-containers';
import { AdminToolsService } from '@/services/admin/admin-tools.service';
import { DEFAULT_PLATFORM_SETTINGS } from '@/services/platform-settings/platform-settings.service';
import type { IDockerOps, LabelledContainer } from '@/lib/docker-ops';

const c = (name: string, slug: string): LabelledContainer => ({ name, slug, state: 'running' });

describe('findOrphanContainers', () => {
  it('matches a labelled dropdeploy-<slug> container whose project is gone', () => {
    expect(findOrphanContainers([c('dropdeploy-old-shop', 'old-shop')], new Set())).toEqual([c('dropdeploy-old-shop', 'old-shop')]);
  });

  it('keeps containers whose project still exists', () => {
    expect(findOrphanContainers([c('dropdeploy-shop', 'shop')], new Set(['shop']))).toEqual([]);
  });

  it.each([
    ['a platform container that borrowed the label', c('dropdeploy-postgres-1', 'postgres')],
    ['a deploy candidate', c('dropdeploy-shop-next-ab12cd34', 'shop')],
    ['a name that only resembles the convention', c('/dropdeploy-shop', 'shop')],
    ['an unlabelled container', c('dropdeploy-redis', '')],
    ['a label outside the slug alphabet', c('dropdeploy-../x', '../x')],
  ])('never matches %s', (_label, container) => {
    expect(findOrphanContainers([container], new Set())).toEqual([]);
  });
});

describe('AdminToolsService cleanup', () => {
  const make = (opts: { slugs?: string[]; retention?: number } = {}) => {
    const docker = {
      listTenantContainers: async () => [c('dropdeploy-gone', 'gone'), c('dropdeploy-live', 'live')],
      removeProjectResources: jest.fn(async () => undefined),
    };
    const proxyHits = { countOlderThan: jest.fn(), deleteOlderThan: jest.fn(async () => 42) };
    const projects = new Set(opts.slugs ?? ['live']);
    const service = new AdminToolsService(
      {
        findExistingSlugs: async (slugs: string[]) => slugs.filter((s) => projects.has(s)),
        findBySlug: async (slug: string) => (projects.has(slug) ? { slug } : null),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      { revoke: jest.fn() },
      docker as unknown as IDockerOps,
      proxyHits,
      { get: async () => ({ ...DEFAULT_PLATFORM_SETTINGS, proxyHitRetentionDays: opts.retention ?? 30 }) },
      { create: jest.fn() },
    );
    return { service, docker, proxyHits, projects };
  };

  it('removes only confirmed slugs that are still orphans when the run starts', async () => {
    const { service, docker } = make();
    const results = await service.removeOrphanContainers(['gone', 'live']);
    expect(docker.removeProjectResources).toHaveBeenCalledTimes(1);
    expect(docker.removeProjectResources).toHaveBeenCalledWith('gone');
    expect(results).toEqual([
      { id: 'gone', ok: true },
      { id: 'live', ok: false, error: 'No longer an orphan; skipped' },
    ]);
  });

  it('skips a slug whose project was created while earlier items were being removed', async () => {
    const { service, docker, projects } = make({ slugs: [] });
    docker.removeProjectResources.mockImplementationOnce(async () => { projects.add('live'); });
    const results = await service.removeOrphanContainers(['gone', 'live']);
    expect(docker.removeProjectResources).toHaveBeenCalledTimes(1);
    expect(results[1]).toEqual({ id: 'live', ok: false, error: 'No longer an orphan; skipped' });
  });

  it('aborts, removing nothing, when the project lookup fails', async () => {
    const { service, docker } = make();
    (service as unknown as { projectRepo: { findExistingSlugs: () => Promise<never> } }).projectRepo = {
      findExistingSlugs: async () => { throw new Error('db down'); },
    };
    await expect(service.removeOrphanContainers(['gone'])).rejects.toThrow('db down');
    expect(docker.removeProjectResources).not.toHaveBeenCalled();
  });

  it('never deletes proxy hits younger than 7 days', async () => {
    const { service, proxyHits } = make({ retention: 6 });
    await expect(service.deleteOldProxyHits(6)).rejects.toThrow('7 days');
    expect(proxyHits.deleteOlderThan).not.toHaveBeenCalled();
  });

  it('refuses a run whose retention differs from the current setting', async () => {
    const { service, proxyHits } = make({ retention: 30 });
    await expect(service.deleteOldProxyHits(90)).rejects.toThrow('preview again');
    expect(proxyHits.deleteOlderThan).not.toHaveBeenCalled();
    await expect(service.deleteOldProxyHits(30)).resolves.toEqual({ deleted: 42 });
  });
});
