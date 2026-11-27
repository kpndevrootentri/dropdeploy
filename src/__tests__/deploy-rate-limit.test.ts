import { createHmac } from 'crypto';

let mockSession = { userId: 'u1', role: 'USER' };
jest.mock('@/lib/get-session', () => ({ getSession: async () => mockSession }));
const mockCreateDeployment = jest.fn(async () => ({ deployment: { id: 'd-new' }, queued: false }));
const mockRetry = jest.fn(async () => ({ id: 'd-retried' }));
const mockRollback = jest.fn(async () => ({ deployment: { id: 'd-rb' }, queued: false }));
const mockFromWebhook = jest.fn(async () => ({ deployment: { id: 'd-hook' }, queued: false }));
jest.mock('@/services/deployment', () => ({
  deploymentService: {
    createDeployment: () => mockCreateDeployment(),
    retryFailedDeployment: () => mockRetry(),
    createRollback: () => mockRollback(),
    createDeploymentFromWebhook: () => mockFromWebhook(),
  },
}));
let mockProjectSource = 'GITHUB';
jest.mock('@/services/project', () => ({
  projectService: { getById: async (id: string) => ({ id, source: mockProjectSource }) },
}));
jest.mock('@/services/upload/upload.deploy.service', () => ({
  uploadDeployService: { rollback: async () => ({ deployment: { id: 'd-upload' }, url: 'u' }) },
}));
jest.mock('@/repositories/audit-log.repository', () => ({ auditLogRepository: { create: async () => ({}) } }));
let mockPushProjects: Array<{ id: string; userId: string; user: { role: string } }> = [];
jest.mock('@/services/webhook', () => ({
  webhookService: { findProjectsForPush: async () => mockPushProjects, getSecret: () => 'secret' },
}));
const mockSeen = new Set<string>();
jest.mock('@/lib/redis', () => ({
  getRedisConnection: () => ({
    set: async (key: string) => (mockSeen.has(key) ? null : (mockSeen.add(key), 'OK')),
    del: async (key: string) => Number(mockSeen.delete(key)),
  }),
}));

import { NextRequest } from 'next/server';
import { POST as deploy } from '@/app/api/projects/[id]/deploy/route';
import { POST as retry } from '@/app/api/projects/[id]/deployments/[deploymentId]/retry/route';
import { POST as rollback } from '@/app/api/projects/[id]/deployments/[deploymentId]/rollback/route';
import { POST as webhook } from '@/app/api/webhooks/github/route';

const HOUR_MS = 60 * 60_000;
const post = (path: string): NextRequest => new NextRequest(`http://localhost:3001${path}`, { method: 'POST' });
const deployAs = (userId: string, role = 'USER'): Promise<Response> => {
  mockSession = { userId, role };
  return deploy(post('/api/projects/p1/deploy'), { params: Promise.resolve({ id: 'p1' }) });
};
const deploymentCtx = { params: Promise.resolve({ id: 'p1', deploymentId: 'd1' }) };

let delivery = 0;
function push(deliveryId: string | null = `delivery-${++delivery}`, ip = '10.0.0.1'): NextRequest {
  const body = JSON.stringify({ ref: 'refs/heads/main', repository: { full_name: 'o/r' } });
  const headers: Record<string, string> = {
    'x-github-event': 'push',
    'x-real-ip': ip, // the per-IP webhook limit is 60/min, so tests use separate IPs
    'x-hub-signature-256': 'sha256=' + createHmac('sha256', 'secret').update(body).digest('hex'),
  };
  if (deliveryId) headers['x-github-delivery'] = deliveryId;
  return new NextRequest('http://localhost:3001/api/webhooks/github', { method: 'POST', headers, body });
}

afterEach(() => jest.restoreAllMocks());

describe('per-user deployment rate limit', () => {
  it('refuses the 21st deployment in an hour with a 429 that says when to retry', async () => {
    for (let i = 0; i < 20; i++) expect((await deployAs('limited')).status).toBe(200);
    const res = await deployAs('limited');
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('3600');
    const body = await res.json();
    expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(body.error.message).toBe('Deployment limit reached: you can start 20 deployments per hour. Try again in 60 minutes.');
  });

  it('leaves other users unaffected', async () => {
    for (let i = 0; i < 21; i++) await deployAs('noisy');
    expect((await deployAs('quiet')).status).toBe(200);
  });

  it('exempts admins', async () => {
    for (let i = 0; i < 30; i++) expect((await deployAs('admin', 'CONTRIBUTOR')).status).toBe(200);
  });

  it('shares one budget across deploy, retry and git rollback, but not upload rollback', async () => {
    mockSession = { userId: 'mixed', role: 'USER' };
    for (let i = 0; i < 7; i++) expect((await deploy(post('/api/projects/p1/deploy'), { params: Promise.resolve({ id: 'p1' }) })).status).toBe(200);
    for (let i = 0; i < 7; i++) expect((await retry(post('/x'), deploymentCtx)).status).toBe(200);
    mockProjectSource = 'GITHUB';
    for (let i = 0; i < 6; i++) expect((await rollback(post('/x'), deploymentCtx)).status).toBe(200);
    expect((await retry(post('/x'), deploymentCtx)).status).toBe(429);
    expect((await rollback(post('/x'), deploymentCtx)).status).toBe(429);
    mockProjectSource = 'UPLOAD';
    expect((await rollback(post('/x'), deploymentCtx)).status).toBe(200);
    mockProjectSource = 'GITHUB';
  });

  it('lets the user deploy again once the hour is over', async () => {
    const start = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(start);
    for (let i = 0; i < 20; i++) await deployAs('reset');
    jest.spyOn(Date, 'now').mockReturnValue(start + HOUR_MS - 60_000);
    const res = await deployAs('reset');
    expect(res.status).toBe(429);
    expect((await res.json()).error.message).toMatch(/Try again in 1 minute\.$/);
    jest.spyOn(Date, 'now').mockReturnValue(start + HOUR_MS + 1);
    expect((await deployAs('reset')).status).toBe(200);
  });
});

describe('per-project push webhook rate limit', () => {
  it('allows 30 push deployments per project per hour, then 429, without affecting other projects', async () => {
    mockPushProjects = [{ id: 'hook-a', userId: 'u1', user: { role: 'USER' } }];
    for (let i = 0; i < 30; i++) expect((await webhook(push())).status).toBe(202);
    const res = await webhook(push());
    expect(res.status).toBe(429);
    expect((await res.json()).error.message).toBe('Push deployment limit reached: 30 per hour per project. Try again in 60 minutes.');

    mockPushProjects = [{ id: 'hook-b', userId: 'u1', user: { role: 'USER' } }];
    expect((await webhook(push())).status).toBe(202);

    // A push matching a limited and a free project still deploys the free one.
    mockFromWebhook.mockClear();
    mockPushProjects = [{ id: 'hook-a', userId: 'u1', user: { role: 'USER' } }, { id: 'hook-b', userId: 'u1', user: { role: 'USER' } }];
    const both = await webhook(push());
    expect(both.status).toBe(202);
    expect((await both.json()).data.triggered).toBe(1);
    expect(mockFromWebhook).toHaveBeenCalledTimes(1);
  });

  it('refuses a push without a delivery ID and ignores replays, so neither uses up the budget', async () => {
    mockPushProjects = [{ id: 'hook-replay', userId: 'u1', user: { role: 'USER' } }];
    expect((await webhook(push('real-1', '10.0.0.2'))).status).toBe(202);
    for (let i = 0; i < 30; i++) expect((await webhook(push('real-1', '10.0.0.2'))).status).toBe(204);
    for (let i = 0; i < 30; i++) {
      const res = await webhook(push(null, '10.0.0.3'));
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe('MISSING_DELIVERY_ID');
    }
    expect((await webhook(push('real-2', '10.0.0.4'))).status).toBe(202);
  });

  it('frees the delivery ID of a push refused for every project, so a GitHub redelivery deploys after the reset', async () => {
    const start = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(start);
    mockPushProjects = [{ id: 'hook-redeliver', userId: 'u-redeliver', user: { role: 'USER' } }];
    for (let i = 0; i < 30; i++) expect((await webhook(push(undefined, '10.0.0.5'))).status).toBe(202);
    expect((await webhook(push('refused-1', '10.0.0.5'))).status).toBe(429);
    jest.spyOn(Date, 'now').mockReturnValue(start + HOUR_MS + 1);
    // GitHub's Redeliver resends the same X-GitHub-Delivery.
    expect((await webhook(push('refused-1', '10.0.0.5'))).status).toBe(202);
    expect((await webhook(push('refused-1', '10.0.0.5'))).status).toBe(204);
  });
});

describe('per-owner push webhook rate limit', () => {
  const fanOut = (userId: string, role: string): Array<{ id: string; userId: string; user: { role: string } }> =>
    ['1', '2', '3'].map((n) => ({ id: `${userId}-p${n}`, userId, user: { role } }));

  it('caps one owner at 60 push deployments per hour across all their projects', async () => {
    mockPushProjects = fanOut('u-fanout', 'USER');
    for (let i = 0; i < 20; i++) expect((await (await webhook(push(undefined, '10.0.0.6'))).json()).data.triggered).toBe(3);
    const res = await webhook(push(undefined, '10.0.0.6'));
    expect(res.status).toBe(429);
    expect((await res.json()).error.message).toBe('Push deployment limit reached: 60 per hour across all your projects. Try again in 60 minutes.');
  });

  it('exempts admins', async () => {
    mockPushProjects = fanOut('u-admin', 'CONTRIBUTOR');
    for (let i = 0; i < 25; i++) expect((await (await webhook(push(undefined, '10.0.0.7'))).json()).data.triggered).toBe(3);
  });
});
