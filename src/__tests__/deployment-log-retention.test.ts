const mockFindMany = jest.fn();
const mockUpdateMany = jest.fn();
const mockDeleteMany = jest.fn();
jest.mock('@/lib/prisma', () => ({
  prisma: {
    deployment: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      updateMany: (...args: unknown[]) => mockUpdateMany(...args),
      deleteMany: (...args: unknown[]) => mockDeleteMany(...args),
    },
  },
}));

// The deployment service's Docker singleton reads the config when it loads.
Object.assign(process.env, {
  DATABASE_URL: 'postgresql://x@localhost/x',
  JWT_SECRET: 'x'.repeat(32),
  ENV_ENCRYPTION_KEY: '0'.repeat(64),
  BASE_DOMAIN: 'app.test',
  NEXT_PUBLIC_BASE_DOMAIN: 'app.test',
});
/* eslint-disable @typescript-eslint/no-require-imports */
const { DeploymentRepository } = require('@/repositories/deployment.repository');
const { DeploymentService } = require('@/services/deployment/deployment.service');
const { emptyBuildLogText } = require('@/lib/build-log-retention');
/* eslint-enable @typescript-eslint/no-require-imports */

const before = new Date('2026-10-28T00:00:00Z');
const old = {
  buildLog: { not: null },
  status: { in: ['DEPLOYED', 'FAILED', 'CANCELLED'] },
  subdomain: null,
  NOT: { status: 'DEPLOYED', imageTag: { not: null } },
  OR: [{ completedAt: { lt: before } }, { completedAt: null, createdAt: { lt: before } }],
};

describe('clearOldBuildLogs', () => {
  beforeEach(() => {
    mockFindMany.mockReset().mockImplementation(async (args: { distinct?: string[]; where: { projectId?: string } }) =>
      args.distinct ? [{ projectId: 'p1' }, { projectId: 'p2' }] : [{ id: `${args.where.projectId}-new` }]);
    mockUpdateMany.mockReset().mockResolvedValueOnce({ count: 3 }).mockResolvedValueOnce({ count: 2 });
    mockDeleteMany.mockReset();
  });

  it('nulls old finished logs per project, sparing live rows, rollback targets (not failed rollbacks), retried rows and the newest ones', async () => {
    expect(await new DeploymentRepository().clearOldBuildLogs(before, 10)).toBe(5);

    expect(mockFindMany).toHaveBeenCalledWith({ where: old, select: { projectId: true }, distinct: ['projectId'] });
    for (const projectId of ['p1', 'p2']) {
      expect(mockFindMany).toHaveBeenCalledWith({
        where: { projectId }, orderBy: { createdAt: 'desc' }, take: 10, select: { id: true },
      });
      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: { ...old, projectId, id: { notIn: [`${projectId}-new`] } },
        data: { buildLog: null },
      });
    }
    expect(mockFindMany).toHaveBeenCalledTimes(3);
    expect(mockDeleteMany).not.toHaveBeenCalled();
  });

  it('makes no per-project queries when no project has old logs', async () => {
    mockFindMany.mockReset().mockResolvedValue([]);
    expect(await new DeploymentRepository().clearOldBuildLogs(before, 10)).toBe(0);
    expect(mockFindMany).toHaveBeenCalledTimes(1);
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it('the service keeps 30 days and the newest 10', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-27T00:00:00Z') });
    const repo = { clearOldBuildLogs: jest.fn().mockResolvedValue(4) };
    const service = new DeploymentService(repo, {}, {}, {}, {}, {});
    expect(await service.clearOldBuildLogs()).toBe(4);
    expect(repo.clearOldBuildLogs).toHaveBeenCalledWith(before, 10);
    jest.useRealTimers();
  });

  it('the empty-log note names the retention policy only for deployments that finished before the cutoff', () => {
    jest.useFakeTimers({ now: new Date('2026-11-27T00:00:00Z') });
    expect(emptyBuildLogText('2026-11-26T23:45:00Z')).toBe('No build log.');
    expect(emptyBuildLogText('2026-10-27T00:00:00Z')).toBe(
      'No build log. Logs are kept for 30 days, and always for the last 10 deployments and the live one.');
    jest.useRealTimers();
  });
});
