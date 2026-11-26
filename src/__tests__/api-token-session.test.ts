const mockVerifySession = jest.fn();
const mockFindByHash = jest.fn();
jest.mock('@/services/auth', () => ({ authService: { verifySession: (t: string) => mockVerifySession(t) } }));
jest.mock('@/repositories/api-token.repository', () => ({
  apiTokenRepository: { findByHash: (h: string) => mockFindByHash(h), touch: async () => {} },
}));

import { NextRequest } from 'next/server';
import { getSession } from '@/lib/get-session';
import { hashApiToken } from '@/services/api-token';

const TOKEN = 'ent_live-token-for-tests';

function request(method: string, path: string, headers: Record<string, string>): NextRequest {
  return new NextRequest(`http://localhost:3001${path}`, { method, headers });
}

const bearer = (path: string, method = 'GET'): NextRequest =>
  request(method, path, { authorization: `Bearer ${TOKEN}` });

function storedToken(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    userId: 'u1',
    name: 'CI',
    prefix: TOKEN.slice(0, 12),
    scope: 'DEPLOY',
    expiresAt: null,
    lastUsedAt: new Date(),
    revokedAt: null,
    createdAt: new Date(),
    user: { id: 'u1', email: 'dev@entri.me', role: 'USER', mustResetPassword: false, suspendedAt: null },
    ...overrides,
  };
}

describe('getSession with an API token', () => {
  beforeEach(() => {
    mockVerifySession.mockReset();
    mockFindByHash.mockReset();
    mockFindByHash.mockImplementation(async (hash: string) => (hash === hashApiToken(TOKEN) ? storedToken() : null));
  });

  it('accepts a Deploy only token on a deploy route', async () => {
    await expect(getSession(bearer('/api/projects/p1/deploy', 'POST'))).resolves.toEqual({
      userId: 'u1',
      email: 'dev@entri.me',
      role: 'USER',
      mustResetPassword: false,
      via: 'api-token',
      tokenScope: 'DEPLOY',
    });
    expect(mockVerifySession).not.toHaveBeenCalled();
  });

  it('refuses a Deploy only token on env vars', async () => {
    await expect(getSession(bearer('/api/projects/x/env-vars'))).rejects.toMatchObject({
      statusCode: 403,
      message: expect.stringMatching(/can only deploy/),
    });
  });

  it('refuses even a Full access token on the admin API', async () => {
    mockFindByHash.mockResolvedValue(storedToken({ scope: 'FULL' }));
    await expect(getSession(bearer('/api/admin/users'))).rejects.toMatchObject({
      statusCode: 403,
      message: expect.stringMatching(/cannot use this endpoint/),
    });
  });

  it('rejects a revoked token with 401', async () => {
    mockFindByHash.mockResolvedValue(storedToken({ revokedAt: new Date() }));
    await expect(getSession(bearer('/api/projects'))).rejects.toMatchObject({
      statusCode: 401,
      message: 'Invalid or expired API token',
    });
  });

  it('rejects an unknown token with 401', async () => {
    mockFindByHash.mockResolvedValue(null);
    await expect(getSession(bearer('/api/projects'))).rejects.toMatchObject({ statusCode: 401 });
  });

  it('refuses a user who must reset their password, as for any session', async () => {
    mockFindByHash.mockResolvedValue(storedToken({ user: { ...storedToken().user, mustResetPassword: true } }));
    await expect(getSession(bearer('/api/projects'))).rejects.toThrow(/Set a new password/);
  });
});

describe('getSession without an API token is unchanged', () => {
  const user = { userId: 'u1', email: 'dev@entri.me', role: 'USER', mustResetPassword: false };

  beforeEach(() => {
    mockFindByHash.mockReset();
    mockVerifySession.mockReset();
    mockVerifySession.mockResolvedValue(user);
  });

  it('reads the cookie, and prefers it over any Bearer token', async () => {
    const req = request('GET', '/api/projects/p1/env-vars', {
      cookie: 'auth-token=jwt-cookie',
      authorization: `Bearer ${TOKEN}`,
    });
    await expect(getSession(req)).resolves.toEqual({ ...user, via: 'cookie' });
    expect(mockVerifySession).toHaveBeenCalledWith('jwt-cookie');
    expect(mockFindByHash).not.toHaveBeenCalled();
  });

  it('reads a login JWT sent as Bearer, with no scope limits', async () => {
    const req = request('DELETE', '/api/projects/p1', { authorization: 'Bearer eyJ.login.jwt' });
    await expect(getSession(req)).resolves.toEqual({ ...user, via: 'jwt' });
    expect(mockVerifySession).toHaveBeenCalledWith('eyJ.login.jwt');
  });

  it('still refuses no credentials', async () => {
    await expect(getSession(request('GET', '/api/projects', {}))).rejects.toMatchObject({ statusCode: 401 });
  });

  it('keeps a "view as user" session from creating or revoking tokens', async () => {
    mockVerifySession.mockResolvedValue({ ...user, impersonatorId: 'admin' });
    const cookie = { cookie: 'auth-token=jwt-cookie' };
    await expect(getSession(request('POST', '/api/tokens', cookie))).rejects.toThrow(/Read-only/);
    await expect(getSession(request('DELETE', '/api/tokens/t1', cookie))).rejects.toThrow(/Read-only/);
  });
});
