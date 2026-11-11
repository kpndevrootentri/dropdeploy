// Redis that is down: the shared client queues every command and never answers.
jest.mock('@/lib/redis', () => ({
  ...jest.requireActual('@/lib/redis'),
  getRedisConnection: () => ({ get: () => new Promise(() => {}) }),
}));
jest.mock('@/lib/queue', () => ({
  getDeploymentQueue: () => ({ getJobCounts: () => new Promise(() => {}) }),
}));
jest.mock('@/lib/get-session', () => ({ getSession: async () => ({ userId: 'admin', role: 'CONTRIBUTOR' }) }));
jest.mock('@/lib/require-contributor', () => ({ requireContributor: () => undefined }));
jest.mock('@/lib/config', () => ({ getConfig: () => ({ BULLMQ_JOB_TIMEOUT_MS: 15 * 60_000 }) }));
const mockFindMany = jest.fn(async () => []);
jest.mock('@/lib/prisma', () => ({ prisma: { deployment: { findMany: mockFindMany } } }));
const mockDiskUsage = jest.fn(async (): Promise<unknown> => null);
jest.mock('@/lib/docker-ops', () => ({ dockerOps: { diskUsage: mockDiskUsage } }));

import { NextRequest } from 'next/server';
import { getWorkerHeartbeat } from '@/lib/worker-health';
import { GET } from '@/app/api/admin/system/route';

describe('system health while Redis is unreachable', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('reports the worker as dead instead of hanging', async () => {
    const heartbeat = getWorkerHeartbeat();
    await jest.advanceTimersByTimeAsync(2_000);
    await expect(heartbeat).resolves.toEqual({ alive: false });
  });

  it('answers with no queue counts and a dead worker instead of hanging', async () => {
    const res = GET(new NextRequest('http://localhost/api/admin/system'));
    await jest.advanceTimersByTimeAsync(2_000);
    const body = await (await res).json();
    expect(body.data.worker).toEqual({ alive: false });
    expect(body.data.queue).toBeNull();
  });

  it('times a build from when it started, not from when it was queued', async () => {
    const res = GET(new NextRequest('http://localhost/api/admin/system'));
    await jest.advanceTimersByTimeAsync(2_000);
    await res;
    const cutoff = expect.any(Date);
    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        OR: [
          { status: 'BUILDING', startedAt: { lt: cutoff } },
          { status: 'QUEUED', createdAt: { lt: cutoff } },
        ],
      },
    }));
  });
});

describe('Docker disk usage on the System tab', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('answers without disk usage instead of hanging when Docker is slow', async () => {
    mockDiskUsage.mockReturnValueOnce(new Promise(() => {}));
    const res = GET(new NextRequest('http://localhost/api/admin/system'));
    await jest.advanceTimersByTimeAsync(5_000);
    const body = await (await res).json();
    expect(body.success).toBe(true);
    expect(body.data.disk).toBeNull();
    expect(body.data.stuck).toEqual([]);
  });
});
