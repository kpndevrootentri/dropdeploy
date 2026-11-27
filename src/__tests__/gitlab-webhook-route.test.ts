jest.mock('@/lib/get-session', () => ({ getSession: async () => ({ userId: 'u1', role: 'USER' }) }));
const mockFromWebhook = jest.fn(async (id: string) => ({ deployment: { id: `d-${id}` }, queued: false }));
jest.mock('@/services/deployment', () => ({
  deploymentService: { createDeploymentFromWebhook: (id: string) => mockFromWebhook(id) },
}));
jest.mock('@/services/project', () => ({ projectService: {} }));
jest.mock('@/repositories/audit-log.repository', () => ({ auditLogRepository: { create: async () => ({}) } }));
type PushProject = { id: string; userId: string; user: { role: string }; secret: string; branch: string };
let mockProjects: PushProject[] = [];
const mockFind = jest.fn();
const mockEnable = jest.fn();
jest.mock('@/services/webhook', () => ({
  webhookService: {
    findProjectsForPush: async (...args: unknown[]) => (mockFind(...args), mockProjects),
    getSecret: (p: PushProject) => p.secret,
    enableAutoDeploy: (...args: unknown[]) => mockEnable(...args),
  },
}));

import { NextRequest } from 'next/server';
import { POST as webhook } from '@/app/api/webhooks/gitlab/route';
import { POST as githubWebhook } from '@/app/api/webhooks/github/route';
import { PATCH } from '@/app/api/projects/[id]/route';

const SECRET_A = 'a'.repeat(64);
const SECRET_B = 'b'.repeat(64);
const project = (id: string, secret = SECRET_A, branch = 'main'): PushProject => ({ id, userId: `owner-${id}`, user: { role: 'USER' }, secret, branch });

let ip = 0;
function push({ token = SECRET_A as string | null, event = 'Push Hook', ref = 'refs/heads/main', headers = {} as Record<string, string> } = {}): NextRequest {
  const body = JSON.stringify({
    object_kind: 'push',
    ref,
    after: 'c'.repeat(40),
    project: { path_with_namespace: 'Group/Sub/Repo' },
  });
  // A fresh IP per request keeps the 60/min per-IP limit out of the way.
  const h: Record<string, string> = { 'x-gitlab-event': event, 'x-real-ip': `10.1.0.${++ip}`, ...headers };
  if (token !== null) h['x-gitlab-token'] = token;
  return new NextRequest('http://localhost:3001/api/webhooks/gitlab', { method: 'POST', headers: h, body });
}

beforeEach(() => {
  mockFromWebhook.mockClear();
  mockFind.mockClear();
});

describe('POST /api/webhooks/gitlab', () => {
  it('acks a non-push event and a push no project follows with 204', async () => {
    mockProjects = [project('p-ack')];
    expect((await webhook(push({ event: 'Merge Request Hook' }))).status).toBe(204);
    mockProjects = [];
    expect((await webhook(push())).status).toBe(204);
    expect(mockFromWebhook).not.toHaveBeenCalled();
  });

  it('refuses a missing or wrong token with 401 and deploys nothing', async () => {
    mockProjects = [project('p-401')];
    for (const token of [null, SECRET_B, 'short']) {
      const res = await webhook(push({ token }));
      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe('INVALID_TOKEN');
    }
    expect(mockFromWebhook).not.toHaveBeenCalled();
  });

  it("deploys only the project whose own secret matches, never another one on the same repo and branch", async () => {
    mockProjects = [project('p-mine', SECRET_A), project('p-theirs', SECRET_B)];
    const res = await webhook(push({ token: SECRET_A }));
    expect(res.status).toBe(202);
    expect((await res.json()).data.triggered).toBe(1);
    expect(mockFind).toHaveBeenCalledWith('group/sub/repo', null, 'GITLAB');
    expect(mockFromWebhook.mock.calls).toEqual([['p-mine']]);
  });

  it("acks with 204 a push to another branch of the repo that the hook's own project doesn't deploy", async () => {
    // The hook sends all branches; dev belongs to another project with its own secret. A 401 would get this hook disabled.
    mockProjects = [project('p-main', SECRET_A, 'main'), project('p-dev', SECRET_B, 'dev')];
    expect((await webhook(push({ token: SECRET_A, ref: 'refs/heads/dev' }))).status).toBe(204);
    expect(mockFromWebhook).not.toHaveBeenCalled();
    expect((await webhook(push({ token: SECRET_B, ref: 'refs/heads/dev' }))).status).toBe(202);
    expect(mockFromWebhook.mock.calls).toEqual([['p-dev']]);
  });

  it('shares the 30 per hour per project push limit with GitHub, answering 202 so GitLab keeps the hook enabled', async () => {
    mockProjects = [project('p-limit')];
    for (let i = 0; i < 30; i++) expect((await webhook(push())).status).toBe(202);
    const res = await webhook(push());
    expect(res.status).toBe(202);
    expect((await res.json()).data).toEqual({ triggered: 0, message: 'Push deployment limit reached: 30 per hour per project. Try again in 60 minutes.' });
    expect(mockFromWebhook).toHaveBeenCalledTimes(30);
  });

  it('applies the same body limits as the GitHub route: 413 over 5 MB, 400 for bad JSON', async () => {
    mockProjects = [project('p-big')];
    const big = 'x'.repeat(5 * 1024 * 1024 + 1);
    const send = (route: typeof webhook, url: string, headers: Record<string, string>, body: string): Promise<Response> =>
      route(new NextRequest(url, { method: 'POST', headers: { 'x-real-ip': `10.1.0.${++ip}`, ...headers }, body }));
    for (const [route, url, headers] of [
      [webhook, 'http://localhost:3001/api/webhooks/gitlab', { 'x-gitlab-event': 'Push Hook' }],
      [githubWebhook, 'http://localhost:3001/api/webhooks/github', { 'x-github-event': 'push' }],
    ] as const) {
      expect((await send(route, url, { ...headers, 'content-length': String(big.length) }, '{}')).status).toBe(413);
      expect((await send(route, url, headers, big)).status).toBe(413);
      const bad = await send(route, url, headers, '{not json');
      expect(bad.status).toBe(400);
      expect((await bad.json()).error.code).toBe('INVALID_PAYLOAD');
    }
  });
});

describe('PATCH /api/projects/:id autoDeploy', () => {
  const patch = (): Promise<Response> => PATCH(
    new NextRequest('http://localhost:3001/api/projects/p1', { method: 'PATCH', body: JSON.stringify({ autoDeploy: true }) }),
    { params: Promise.resolve({ id: 'p1' }) },
  );
  const stored = { id: 'p1', autoDeploy: true, webhookSecretEnc: 'enc', webhookSecretIv: 'iv', webhookSecretTag: 'tag' };

  it('returns the GitLab URL and secret once, and never the stored secret columns', async () => {
    mockEnable.mockResolvedValueOnce({ project: stored, gitlabWebhook: { url: 'https://app.test/api/webhooks/gitlab', secret: SECRET_A } });
    const { data } = await (await patch()).json();
    expect(data).toEqual({ id: 'p1', autoDeploy: true, gitlabWebhook: { url: 'https://app.test/api/webhooks/gitlab', secret: SECRET_A } });
  });

  it('adds nothing for a GitHub project', async () => {
    mockEnable.mockResolvedValueOnce({ project: stored });
    const { data } = await (await patch()).json();
    expect(data).toEqual({ id: 'p1', autoDeploy: true });
  });
});
