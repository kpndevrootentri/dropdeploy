import type { GitProvider } from '@prisma/client';
import type { UpdateTokenData, UpsertGitProviderData } from '@/repositories/git-provider.repository';

// Set before the service loads: getConfig caches the env on first use.
Object.assign(process.env, { GITLAB_CLIENT_ID: 'gl-client', GITLAB_CLIENT_SECRET: 'gl-secret', APP_URL: 'https://app.test' });

jest.mock('@/lib/prisma', () => ({ prisma: {} }));
jest.mock('@/lib/providers/gitlab', () => ({
  ...jest.requireActual('@/lib/providers/gitlab'),
  refreshGitLabToken: jest.fn(),
}));

/* eslint-disable @typescript-eslint/no-require-imports */
const { GitProviderService } = require('@/services/git-provider/git-provider.service') as typeof import('@/services/git-provider/git-provider.service');
const { EncryptionService } = require('@/services/encryption') as typeof import('@/services/encryption');
const { refreshGitLabToken } = require('@/lib/providers/gitlab') as { refreshGitLabToken: jest.Mock };
/* eslint-enable @typescript-eslint/no-require-imports */

const encryption = new EncryptionService('0'.repeat(64));
const MINUTE = 60 * 1000;

/** An in-memory IGitProviderRepository holding one user's rows by provider. */
function memoryRepo() {
  const rows = new Map<string, GitProvider>();
  return {
    rows,
    findByUserId: async (userId: string) => [...rows.values()].filter((r) => r.userId === userId),
    findByUserAndProvider: async (userId: string, provider: string) => {
      const row = rows.get(provider);
      return row?.userId === userId ? row : null;
    },
    upsert: async (userId: string, data: UpsertGitProviderData) => {
      const now = new Date();
      const row = {
        id: `gp-${data.provider}`, userId, createdAt: now, updatedAt: now,
        avatarUrl: null, encryptedRefreshToken: null, refreshIv: null, refreshAuthTag: null, tokenExpiresAt: null,
        ...data,
      } as GitProvider;
      rows.set(data.provider, row);
      return row;
    },
    updateToken: async (id: string, data: UpdateTokenData) => {
      const [provider, row] = [...rows.entries()].find(([, r]) => r.id === id)!;
      const updated = { ...row, ...data } as GitProvider;
      rows.set(provider, updated);
      return updated;
    },
    delete: async (_userId: string, provider: string) => {
      rows.delete(provider);
    },
  };
}

function setup() {
  const repo = memoryRepo();
  return { repo, service: new GitProviderService(repo, encryption) };
}

const decrypt = (value: string, iv: string, authTag: string) => encryption.decrypt({ encryptedValue: value, iv, authTag });
const github = { provider: 'GITHUB' as const, providerUserId: '1', username: 'octo', accessToken: 'gho_fake_access' };
const gitlab = (expiresInSeconds: number, refreshToken: string | null = 'glrt-fake-refresh') => ({
  provider: 'GITLAB' as const, providerUserId: '2', username: 'tanuki', accessToken: 'glpat-fake-access', refreshToken, expiresInSeconds,
});

beforeEach(() => refreshGitLabToken.mockReset());

it('stores tokens only encrypted and returns no token fields', async () => {
  const { repo, service } = setup();
  const before = Date.now();
  const info = await service.connect('u1', gitlab(7200));
  const row = repo.rows.get('GITLAB')!;
  expect(JSON.stringify(row)).not.toMatch(/glpat-fake-access|glrt-fake-refresh/);
  expect(decrypt(row.encryptedToken, row.iv, row.authTag)).toBe('glpat-fake-access');
  expect(decrypt(row.encryptedRefreshToken!, row.refreshIv!, row.refreshAuthTag!)).toBe('glrt-fake-refresh');
  expect(Object.keys(info).sort()).toEqual(['avatarUrl', 'createdAt', 'id', 'provider', 'tokenExpiresAt', 'updatedAt', 'username']);
  expect(info.tokenExpiresAt!.getTime()).toBeGreaterThanOrEqual(before + 7200 * 1000);
  expect(info.tokenExpiresAt!.getTime()).toBeLessThanOrEqual(Date.now() + 7200 * 1000);
});

describe('getTokenForDeployment', () => {
  it('is null without a connection', async () => {
    await expect(setup().service.getTokenForDeployment('u1', 'GITHUB')).resolves.toBeNull();
  });

  it('decrypts a GitHub token, and a GitLab token with time left, without refreshing', async () => {
    const { service } = setup();
    await service.connect('u1', github);
    await service.connect('u1', gitlab(3600));
    await expect(service.getTokenForDeployment('u1', 'GITHUB')).resolves.toBe('gho_fake_access');
    await expect(service.getTokenForDeployment('u1', 'GITLAB')).resolves.toBe('glpat-fake-access');
    expect(refreshGitLabToken).not.toHaveBeenCalled();
  });

  it('refreshes a GitLab token within 5 minutes of expiry and stores the new tokens encrypted', async () => {
    const { repo, service } = setup();
    await service.connect('u1', gitlab(4 * 60));
    refreshGitLabToken.mockResolvedValue({ access_token: 'glpat-fake-new', refresh_token: 'glrt-fake-new', expires_in: 7200 });
    await expect(service.getTokenForDeployment('u1', 'GITLAB')).resolves.toBe('glpat-fake-new');
    expect(refreshGitLabToken).toHaveBeenCalledWith('gl-client', 'gl-secret', 'glrt-fake-refresh', 'https://app.test/api/auth/gitlab/callback');
    const row = repo.rows.get('GITLAB')!;
    expect(JSON.stringify(row)).not.toMatch(/glpat-fake-new|glrt-fake-new/);
    expect(decrypt(row.encryptedToken, row.iv, row.authTag)).toBe('glpat-fake-new');
    expect(decrypt(row.encryptedRefreshToken!, row.refreshIv!, row.refreshAuthTag!)).toBe('glrt-fake-new');
    expect(row.tokenExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 100 * MINUTE);
    // Now fresh: no second refresh.
    await expect(service.getTokenForDeployment('u1', 'GITLAB')).resolves.toBe('glpat-fake-new');
    expect(refreshGitLabToken).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['GitLab rejects the refresh token', gitlab(60), () => refreshGitLabToken.mockResolvedValue({})],
    ['no refresh token is stored', gitlab(60, null), () => undefined],
  ])('disconnects GitLab and returns null when %s', async (_name, dto, arrange) => {
    const { repo, service } = setup();
    await service.connect('u1', dto);
    arrange();
    await expect(service.getTokenForDeployment('u1', 'GITLAB')).resolves.toBeNull();
    expect(repo.rows.has('GITLAB')).toBe(false);
  });

  it('keeps the connection when the refresh fails for another reason (outage, rate limit, network)', async () => {
    const { repo, service } = setup();
    await service.connect('u1', gitlab(60));
    const row = repo.rows.get('GITLAB');
    refreshGitLabToken.mockRejectedValue(new Error('GitLab token refresh failed with status 503'));
    await expect(service.getTokenForDeployment('u1', 'GITLAB')).resolves.toBeNull();
    expect(repo.rows.get('GITLAB')).toBe(row);
  });

  it('two refreshes at once both get the rotated token and keep the connection', async () => {
    const { repo, service } = setup();
    await service.connect('u1', gitlab(60));
    // GitLab rotates refresh tokens: the second use of one is rejected.
    const spent = new Set<string>();
    refreshGitLabToken.mockImplementation(async (_id: string, _secret: string, refresh: string) => {
      if (spent.has(refresh)) return {};
      spent.add(refresh);
      return { access_token: 'glpat-fake-new', refresh_token: 'glrt-fake-new', expires_in: 7200 };
    });
    await expect(Promise.all([service.getTokenForDeployment('u1', 'GITLAB'), service.getTokenForDeployment('u1', 'GITLAB')]))
      .resolves.toEqual(['glpat-fake-new', 'glpat-fake-new']);
    expect(refreshGitLabToken).toHaveBeenCalledTimes(2);
    expect(repo.rows.has('GITLAB')).toBe(true);
  });
});

describe('refreshGitLabToken', () => {
  const { refreshGitLabToken: realRefresh } = jest.requireActual('@/lib/providers/gitlab') as typeof import('@/lib/providers/gitlab');
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });
  const respond = (status: number) => { global.fetch = jest.fn(async () => new Response('{}', { status })) as unknown as typeof fetch; };

  it('reports a rejected refresh token (400) as no tokens', async () => {
    respond(400);
    await expect(realRefresh('id', 'secret', 'glrt-fake', 'https://app.test/cb')).resolves.toEqual({});
  });

  it.each([401, 429, 503])('throws on HTTP %s, so the connection is kept', async (status) => {
    respond(status);
    await expect(realRefresh('id', 'secret', 'glrt-fake', 'https://app.test/cb')).rejects.toThrow(String(status));
  });
});

it('listRepos throws NotFoundError without a connection', async () => {
  await expect(setup().service.listRepos('u1', 'GITHUB', '', 1)).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
});
