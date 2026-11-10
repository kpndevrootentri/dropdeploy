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
      {} as never,
      {} as never,
      { create: jest.fn() },
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

describe('AdminToolsService.revokeAccess', () => {
  const collaborator = { id: 'acc1', kind: 'USER', userId: 'u2', domain: null, email: 'dev@example.com' };
  const make = (create: jest.Mock, entries: unknown[] = [collaborator]) => {
    const revoke = jest.fn(async () => undefined);
    const service = new AdminToolsService(
      { findById: async () => ({ id: 'p1', slug: 'shop', userId: 'owner' }) } as never,
      {} as never,
      { listByProject: async () => entries } as never,
      {} as never,
      { revoke },
      {} as IDockerOps,
      {} as never,
      {} as never,
      { create },
    );
    return { service, revoke };
  };

  it('revokes as the owner and audits the acting admin and the removed email', async () => {
    const create = jest.fn(async () => ({}) as never);
    const { service, revoke } = make(create);
    await service.revokeAccess('p1', 'acc1', 'admin1');
    expect(revoke).toHaveBeenCalledWith('p1', 'owner', 'acc1');
    expect(create).toHaveBeenCalledWith({ action: 'ACCESS_ADMIN_REVOKED', targetKey: 'dev@example.com', userId: 'admin1', projectId: 'p1' });
  });

  it('records a domain grant by its domain and falls back to the entry id', async () => {
    const domainCreate = jest.fn(async () => ({}) as never);
    await make(domainCreate, [{ ...collaborator, kind: 'DOMAIN', userId: null, email: null, domain: 'example.com' }]).service.revokeAccess('p1', 'acc1', 'admin1');
    expect(domainCreate).toHaveBeenCalledWith(expect.objectContaining({ targetKey: 'example.com' }));

    const unknownCreate = jest.fn(async () => ({}) as never);
    await make(unknownCreate, []).service.revokeAccess('p1', 'acc1', 'admin1');
    expect(unknownCreate).toHaveBeenCalledWith(expect.objectContaining({ targetKey: 'acc1' }));
  });

  it('still succeeds when the audit write fails', async () => {
    const { service, revoke } = make(jest.fn(async () => { throw new Error('db down'); }));
    await expect(service.revokeAccess('p1', 'acc1', 'admin1')).resolves.toBeUndefined();
    expect(revoke).toHaveBeenCalled();
  });

  it('writes no audit entry when the revoke fails', async () => {
    const create = jest.fn();
    const { service, revoke } = make(create);
    revoke.mockRejectedValueOnce(new Error('Access entry not found'));
    await expect(service.revokeAccess('p1', 'acc1', 'admin1')).rejects.toThrow('Access entry not found');
    expect(create).not.toHaveBeenCalled();
  });
});
