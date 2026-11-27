import { createHmac, timingSafeEqual } from 'crypto';
import { UnrecoverableError, type Job } from 'bullmq';

process.env.APP_URL = 'https://dash.test';

const mockPost = jest.fn();
jest.mock('@/lib/outbound-webhook', () => ({
  ...jest.requireActual('@/lib/outbound-webhook'),
  postJson: (...args: unknown[]) => mockPost(...args),
}));
const mockPrisma = {
  $transaction: jest.fn(async (ops: unknown[]) => ops),
  notificationHook: { deleteMany: jest.fn(() => 'delete-hooks') },
  project: { update: jest.fn(() => 'update-owner') },
};
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

import { NotificationService } from '@/services/notification';
import { EncryptionService } from '@/services/encryption';
import { BlockedAddressError } from '@/lib/outbound-webhook';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { ProjectRepository } from '@/repositories/project.repository';
import type { NotificationJob } from '@/lib/queue';

type HookRow = { id: string; projectId: string; host: string; configEnc: string; configIv: string; configTag: string; events: string[]; lastStatus: string | null; lastAttemptAt: Date | null; createdAt: Date };

const encryption = new EncryptionService('0'.repeat(64));
const project = { id: 'p1', userId: 'owner', name: 'Shop <!channel> & co', slug: 'shop' };

function setup(deployment: Record<string, unknown> = {}) {
  const rows: HookRow[] = [];
  const hooks = {
    listByProject: jest.fn(async (projectId: string) => rows.filter((r) => r.projectId === projectId)),
    findById: jest.fn(async (id: string) => rows.find((r) => r.id === id) ?? null),
    countByProject: jest.fn(async (projectId: string) => rows.filter((r) => r.projectId === projectId).length),
    create: jest.fn(async (data: Omit<HookRow, 'id' | 'lastStatus' | 'lastAttemptAt' | 'createdAt'>) => {
      const row = { id: `h${rows.length + 1}`, lastStatus: null, lastAttemptAt: null, createdAt: new Date(), ...data };
      rows.push(row);
      return row;
    }),
    delete: jest.fn(async (id: string, projectId: string) => {
      const i = rows.findIndex((r) => r.id === id && r.projectId === projectId);
      return i >= 0 && rows.splice(i, 1).length === 1;
    }),
    setLastStatus: jest.fn(async (id: string, status: string) => {
      const row = rows.find((r) => r.id === id);
      if (row) row.lastStatus = status;
    }),
  };
  const deployments = {
    findByIdWithProject: jest.fn(async () => ({ id: 'd1', status: 'DEPLOYED', commitHash: 'abc1234def', failureReason: null, completedAt: null, ...deployment, project })),
  };
  const projects = { findById: jest.fn(async (id: string) => (id === project.id ? project : null)) };
  const queue = { add: jest.fn<Promise<void>, [NotificationJob]>(async () => undefined) };
  const service = new NotificationService(hooks as never, deployments as never, projects as never, encryption, queue);
  const job = (hookId: string, event = 'deployment.failed'): Job<NotificationJob> =>
    ({ id: 'delivery-1', data: { hookId, event, payload: { event, project: { id: 'p1', name: project.name, slug: 'shop', url: 'https://shop.app.test' }, deployment: { failureReason: 'npm error <@everyone>' } } } }) as never;
  return { service, rows, hooks, deployments, queue, job };
}

async function addHook(s: ReturnType<typeof setup>, url: string, events = ['deployment.succeeded', 'deployment.failed']) {
  return s.service.create('p1', 'owner', { url, events: events as never });
}

beforeEach(() => mockPost.mockReset());

describe('managing hooks', () => {
  it('returns the secret once, queues a ping, never lists the URL or secret, and allows 3 per project', async () => {
    const s = setup();
    const created = await addHook(s, 'https://hooks.slack.com/services/T/B/secret-path');
    expect(created).toMatchObject({ host: 'hooks.slack.com', kind: 'slack', secret: expect.stringMatching(/^[0-9a-f]{64}$/) });
    await Promise.resolve();
    expect(s.queue.add).toHaveBeenCalledWith(expect.objectContaining({ hookId: created.id, event: 'ping' }));

    const listed = JSON.stringify(await s.service.list('p1', 'owner'));
    expect(listed).not.toContain('secret-path');
    expect(listed).not.toContain(created.secret);

    await addHook(s, 'https://discord.com/api/webhooks/1/x');
    await addHook(s, 'https://example.com/hook');
    await expect(addHook(s, 'https://example.com/four')).rejects.toBeInstanceOf(ValidationError);
  });

  it("is the owner's only: everyone else gets a 404", async () => {
    const s = setup();
    const { id } = await addHook(s, 'https://example.com/hook');
    await expect(s.service.list('p1', 'intruder')).rejects.toBeInstanceOf(NotFoundError);
    await expect(s.service.create('p1', 'intruder', { url: 'https://example.com/x', events: ['deployment.failed'] })).rejects.toBeInstanceOf(NotFoundError);
    await expect(s.service.remove('p1', 'intruder', id)).rejects.toBeInstanceOf(NotFoundError);
    expect(s.rows).toHaveLength(1);
  });

  it('are deleted with the owner change, in the same transaction', async () => {
    await new ProjectRepository().transferOwner('p1', 'new-owner');
    expect(mockPrisma.notificationHook.deleteMany).toHaveBeenCalledWith({ where: { projectId: 'p1' } });
    expect(mockPrisma.$transaction).toHaveBeenCalledWith(['delete-hooks', 'update-owner']);
  });
});

describe('deploymentFinished', () => {
  it.each([
    ['DEPLOYED', 'deployment.succeeded'],
    ['FAILED', 'deployment.failed'],
  ])('queues %s as %s, only to the hooks that want it, without URLs or secrets', async (status, event) => {
    const s = setup({ status, failureReason: status === 'FAILED' ? 'npm error Missing script' : null });
    const both = await addHook(s, 'https://example.com/both');
    await addHook(s, 'https://example.com/other', [event === 'deployment.failed' ? 'deployment.succeeded' : 'deployment.failed']);
    s.queue.add.mockClear();

    await s.service.deploymentFinished('d1');
    expect(s.queue.add).toHaveBeenCalledTimes(1);
    const [job] = s.queue.add.mock.calls[0];
    expect(job).toMatchObject({
      hookId: both.id,
      event,
      payload: {
        event,
        project: { id: 'p1', slug: 'shop', url: 'https://shop.app.test' },
        deployment: { id: 'd1', status, dashboardUrl: 'https://dash.test/projects/p1' },
      },
    });
    expect(JSON.stringify(job)).not.toMatch(/example\.com|[0-9a-f]{64}/);
  });

  it.each(['CANCELLED', 'BUILDING'])('queues nothing for %s', async (status) => {
    const s = setup({ status });
    await addHook(s, 'https://example.com/hook');
    s.queue.add.mockClear();
    await s.service.deploymentFinished('d1');
    expect(s.queue.add).not.toHaveBeenCalled();
  });

  it('never rejects, so it cannot fail a deploy', async () => {
    const s = setup();
    s.deployments.findByIdWithProject.mockRejectedValueOnce(new Error('database is down'));
    await expect(s.service.deploymentFinished('d1')).resolves.toBeUndefined();
  });
});

describe('deliver', () => {
  it('formats by host and signs `<timestamp>.<body>` with the secret', async () => {
    const s = setup();
    const generic = await addHook(s, 'https://example.com/hook');
    const slack = await addHook(s, 'https://hooks.slack.com/services/T/B/x');
    const discord = await addHook(s, 'https://discord.com/api/webhooks/1/x');
    mockPost.mockResolvedValue(200);

    await s.service.deliver(s.job(generic.id));
    const [url, body, headers] = mockPost.mock.calls[0];
    expect((url as URL).href).toBe('https://example.com/hook');
    expect(JSON.parse(body)).toMatchObject({ event: 'deployment.failed', project: { slug: 'shop' } });
    expect(headers).toMatchObject({ 'X-Entrify-Event': 'deployment.failed', 'X-Entrify-Delivery': 'delivery-1' });
    // A receiver's own check, as in the docs.
    const expected = Buffer.from('sha256=' + createHmac('sha256', generic.secret).update(`${headers['X-Entrify-Timestamp']}.${body}`).digest('hex'));
    expect(timingSafeEqual(Buffer.from(headers['X-Entrify-Signature']), expected)).toBe(true);
    expect(s.rows[0].lastStatus).toBe('200');

    await s.service.deliver(s.job(slack.id));
    expect(JSON.parse(mockPost.mock.calls[1][1])).toEqual({ text: 'Deployment of Shop &lt;!channel&gt; &amp; co failed: npm error &lt;@everyone&gt;' });

    await s.service.deliver(s.job(discord.id));
    expect(JSON.parse(mockPost.mock.calls[2][1])).toEqual({
      content: 'Deployment of Shop <!channel> & co failed: npm error <@everyone>',
      allowed_mentions: { parse: [] },
    });
  });

  it.each([
    [500, '500', false],
    [429, '429', false],
    [new DOMException('The operation was aborted', 'AbortError'), 'timeout', false],
    [Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }), 'unreachable', false],
    [404, '404', true],
    [301, '301', true],
    [new BlockedAddressError('example.com'), 'blocked', true],
  ])('after %p records %s and gives up: %s', async (result, status, givesUp) => {
    const s = setup();
    const { id } = await addHook(s, 'https://example.com/hook');
    if (typeof result === 'number') mockPost.mockResolvedValueOnce(result);
    else mockPost.mockRejectedValueOnce(result);

    const err = await s.service.deliver(s.job(id)).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err instanceof UnrecoverableError).toBe(givesUp);
    expect(String(err)).not.toContain('/hook');
    expect(s.rows[0].lastStatus).toBe(status);
  });

  it('sends nothing for a hook deleted after it was queued', async () => {
    const s = setup();
    await expect(s.service.deliver(s.job('gone'))).resolves.toBeUndefined();
    expect(mockPost).not.toHaveBeenCalled();
  });
});
