// The Prisma client loads .env when it is imported; the service under test gets fakes instead.
jest.mock('@/lib/prisma', () => ({ prisma: {} }));

import { verifyGitLabToken, parseGitLabPush } from '@/lib/gitlab-webhook';
import { NotFoundError, ValidationError } from '@/lib/errors';

// Set before the service loads: the config is read and cached on import.
process.env.APP_URL = 'https://app.test';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { WebhookService } = require('@/services/webhook/webhook.service') as typeof import('@/services/webhook/webhook.service');

const SECRET = 'a'.repeat(64);

describe('verifyGitLabToken', () => {
  it('accepts the exact token', () => {
    expect(verifyGitLabToken(SECRET, SECRET)).toBe(true);
  });

  it('rejects a wrong, missing or different-length token without throwing', () => {
    expect(verifyGitLabToken('b'.repeat(64), SECRET)).toBe(false);
    expect(verifyGitLabToken(null, SECRET)).toBe(false);
    expect(verifyGitLabToken('', SECRET)).toBe(false);
    expect(verifyGitLabToken(SECRET.slice(1), SECRET)).toBe(false);
  });
});

describe('parseGitLabPush', () => {
  const push = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    object_kind: 'push',
    ref: 'refs/heads/main',
    after: 'c'.repeat(40),
    project: { path_with_namespace: 'Group/Sub/Repo' },
    ...over,
  });

  it('returns the lowercased path, subgroups included, and the branch', () => {
    expect(parseGitLabPush(push())).toEqual({ path: 'group/sub/repo', branch: 'main' });
    expect(parseGitLabPush(push({ ref: 'refs/heads/feature/x' }))).toEqual({ path: 'group/sub/repo', branch: 'feature/x' });
  });

  it.each([
    ['a tag push', push({ object_kind: 'tag_push', ref: 'refs/tags/v1' })],
    ['a tag ref on a push', push({ ref: 'refs/tags/v1' })],
    ['a branch delete', push({ after: '0'.repeat(40) })],
    ['a missing project', push({ project: undefined })],
    ['another event', push({ object_kind: 'merge_request' })],
    ['a non-object payload', null],
  ])('returns null for %s', (_label, payload) => {
    expect(parseGitLabPush(payload as never)).toBeNull();
  });
});

describe('WebhookService for GitLab projects', () => {

  const gitlabProject = { id: 'p1', userId: 'u1', source: 'GITLAB', githubUrl: 'https://gitlab.com/Group/Sub/Repo.git', githubHookId: null };
  const setup = (project: Record<string, unknown> | null = gitlabProject, candidates: unknown[] = []) => {
    const projectRepo = {
      findById: jest.fn().mockResolvedValue(project),
      setWebhookConfig: jest.fn(async (id: string, data: object) => ({ ...project, ...data, autoDeploy: true })),
      findAutoDeployByBranch: jest.fn().mockResolvedValue(candidates),
    };
    const gitProvider = { getTokenForDeployment: jest.fn() };
    const encryption = { encrypt: (v: string) => ({ encryptedValue: `enc:${v}`, iv: 'iv', authTag: 'tag' }), decrypt: jest.fn() };
    const service = new WebhookService(projectRepo as never, gitProvider as never, encryption as never);
    return { service, projectRepo, gitProvider };
  };

  it('stores an encrypted secret without a hook id, calls nothing remote, and returns the URL and secret', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const { service, projectRepo, gitProvider } = setup();
    const { gitlabWebhook } = await service.enableAutoDeploy('p1', 'u1');
    expect(gitlabWebhook?.url).toBe('https://app.test/api/webhooks/gitlab');
    expect(gitlabWebhook?.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(projectRepo.setWebhookConfig).toHaveBeenCalledWith('p1', {
      githubHookId: null,
      webhookSecretEnc: `enc:${gitlabWebhook?.secret}`,
      webhookSecretIv: 'iv',
      webhookSecretTag: 'tag',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(gitProvider.getTokenForDeployment).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("refuses an upload project and hides another user's project", async () => {
    await expect(setup({ ...gitlabProject, source: 'UPLOAD', githubUrl: null }).service.enableAutoDeploy('p1', 'u1')).rejects.toThrow(ValidationError);
    await expect(setup().service.enableAutoDeploy('p1', 'someone-else')).rejects.toThrow(NotFoundError);
  });

  it('matches a push by the full GitLab path, subgroups included', async () => {
    const match = { id: 'a', githubUrl: 'https://gitlab.com/group/sub/repo' };
    const sibling = { id: 'b', githubUrl: 'https://gitlab.com/group/sub/other' };
    const parent = { id: 'c', githubUrl: 'https://gitlab.com/group/sub' };
    const { service, projectRepo } = setup(null, [match, sibling, parent]);
    expect(await service.findProjectsForPush('group/sub/repo', 'main', 'GITLAB')).toEqual([match]);
    expect(projectRepo.findAutoDeployByBranch).toHaveBeenCalledWith('main', 'GITLAB');
  });
});
