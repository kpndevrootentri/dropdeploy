const mockFindFirst = jest.fn();
const mockFindMany = jest.fn();
jest.mock('@/lib/prisma', () => ({
  prisma: {
    deployment: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
      findMany: (...args: unknown[]) => mockFindMany(...args),
      count: async () => 7,
    },
  },
}));
jest.mock('@/lib/get-session', () => ({ getSession: async () => ({ userId: 'u1', via: 'jwt' }) }));
const mockProject: { id: string; userId: string; webhookSecretEnc: string; deployments: { id: string; createdAt: Date }[] } = {
  id: 'p1', userId: 'u1', webhookSecretEnc: 'secret', deployments: [],
};
jest.mock('@/services/project', () => ({
  projectService: { getById: async () => mockProject, getByIdWithDeployments: async () => mockProject },
}));
jest.mock('@/services/webhook', () => ({ webhookService: {} }));
jest.mock('@/repositories/audit-log.repository', () => ({ auditLogRepository: {} }));

import { NextRequest } from 'next/server';

// The deployment service's Docker singleton reads the config when it loads.
Object.assign(process.env, {
  DATABASE_URL: 'postgresql://x@localhost/x',
  JWT_SECRET: 'x'.repeat(32),
  ENV_ENCRYPTION_KEY: '0'.repeat(64),
  BASE_DOMAIN: 'app.test',
  NEXT_PUBLIC_BASE_DOMAIN: 'app.test',
});
/* eslint-disable @typescript-eslint/no-require-imports */
const { GET: getProject } = require('@/app/api/projects/[id]/route');
const { GET: getDeployments } = require('@/app/api/projects/[id]/deployments/route');
/* eslint-enable @typescript-eslint/no-require-imports */

const newest = { id: 'd2', createdAt: new Date('2026-11-02T00:00:00Z') };
const oldest = { id: 'd1', createdAt: new Date('2026-11-01T00:00:00Z') };
const ctx = { params: Promise.resolve({ id: 'p1' }) };
const req = (path: string): NextRequest => new NextRequest(`http://localhost:3001${path}`);

const expectLookupBefore = (before: Date): void =>
  expect(mockFindFirst).toHaveBeenCalledWith({
    where: { projectId: 'p1', status: 'DEPLOYED', commitHash: { not: null }, createdAt: { lt: before } },
    orderBy: { createdAt: 'desc' },
    select: { commitHash: true },
  });

describe('previousDeployedCommit', () => {
  beforeEach(() => {
    mockFindFirst.mockReset().mockResolvedValue({ commitHash: 'abc1234' });
    mockFindMany.mockReset().mockResolvedValue([newest, oldest]);
    mockProject.deployments = [newest, oldest];
  });

  it('GET /api/projects/:id/deployments adds the newest successful commit older than the page', async () => {
    const res = await getDeployments(req('/api/projects/p1/deployments?skip=5&limit=5'), ctx);
    expect(await res.json()).toEqual({
      success: true,
      data: { deployments: JSON.parse(JSON.stringify([newest, oldest])), total: 7, previousDeployedCommit: 'abc1234' },
    });
    expectLookupBefore(oldest.createdAt);
  });

  it('GET /api/projects/:id adds it next to the project fields, still without webhook secrets', async () => {
    const body = await (await getProject(req('/api/projects/p1'), ctx)).json();
    expect(body.data).toMatchObject({ id: 'p1', previousDeployedCommit: 'abc1234' });
    expect(body.data).not.toHaveProperty('webhookSecretEnc');
    expectLookupBefore(oldest.createdAt);
  });

  it('is null when no older successful deployment has a commit', async () => {
    mockFindFirst.mockResolvedValue(null);
    expect((await (await getProject(req('/api/projects/p1'), ctx)).json()).data.previousDeployedCommit).toBeNull();
    expect((await (await getDeployments(req('/api/projects/p1/deployments'), ctx)).json()).data.previousDeployedCommit).toBeNull();
  });

  it('is null without a lookup when there are no deployments', async () => {
    mockProject.deployments = [];
    mockFindMany.mockResolvedValue([]);
    expect((await (await getProject(req('/api/projects/p1'), ctx)).json()).data.previousDeployedCommit).toBeNull();
    expect((await (await getDeployments(req('/api/projects/p1/deployments?skip=10'), ctx)).json()).data.previousDeployedCommit).toBeNull();
    expect(mockFindFirst).not.toHaveBeenCalled();
  });
});
