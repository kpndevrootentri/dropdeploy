jest.mock('@/lib/docker-ops', () => ({ dockerOps: {}, containerNameFor: (slug: string) => `dropdeploy-${slug}` }));
jest.mock('@/services/project-access/project-access.service', () => ({ projectAccessService: {} }));

import { AdminToolsService } from '@/services/admin/admin-tools.service';
import { containerUsageFromStats } from '@/lib/container-usage';
import type { IDockerOps } from '@/lib/docker-ops';

describe('containerUsageFromStats', () => {
  it('computes CPU like `docker stats` and drops the page cache from memory', () => {
    expect(
      containerUsageFromStats({
        cpu_stats: { cpu_usage: { total_usage: 300 }, system_cpu_usage: 2000, online_cpus: 4 },
        precpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 1000 },
        memory_stats: { usage: 300, limit: 1000, stats: { inactive_file: 100 } },
      }),
    ).toEqual({ cpuPercent: 80, memoryUsedBytes: 200, memoryLimitBytes: 1000 });
  });

  it('treats a stopped container (no memory usage) as no usage', () => {
    expect(containerUsageFromStats({ memory_stats: {} })).toBeNull();
  });
});

describe('AdminToolsService.getProjectDetails', () => {
  const make = (containerStats: IDockerOps['containerStats']) =>
    new AdminToolsService(
      { findById: async () => ({ id: 'p1', slug: 'shop', userId: 'u1' }) } as never,
      {
        findByProjectId: async () => [
          { key: 'API_KEY', environment: 'PRODUCTION', encryptedValue: 'secret', iv: 'iv', authTag: 'tag' },
        ],
      } as never,
      { listByProject: async () => [] } as never,
      { listByProject: async () => [] } as never,
      { revoke: jest.fn() },
      { containerStats } as unknown as IDockerOps,
    );

  it('returns env var names only, never values', async () => {
    const details = await make(async () => null).getProjectDetails('p1');
    expect(details.envKeys).toEqual([{ key: 'API_KEY', environment: 'PRODUCTION' }]);
    expect(JSON.stringify(details)).not.toContain('secret');
  });

  it('still loads when the worker cannot report usage', async () => {
    const details = await make(async () => { throw new Error('The deployment worker did not respond.'); }).getProjectDetails('p1');
    expect(details.usage).toBeNull();
    expect(details.usageError).toMatch('did not respond');
  });
});
