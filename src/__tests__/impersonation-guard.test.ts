const mockVerifySession = jest.fn();
jest.mock('@/services/auth', () => ({ authService: { verifySession: (t: string) => mockVerifySession(t) } }));

import { NextRequest } from 'next/server';
import { getSession } from '@/lib/get-session';
import { impersonationBlockReason } from '@/lib/impersonation';

function request(method: string, path: string): NextRequest {
  return new NextRequest(`http://localhost:3001${path}`, { method, headers: { cookie: 'auth-token=t' } });
}

describe('getSession while an admin views as a user', () => {
  beforeEach(() => {
    mockVerifySession.mockResolvedValue({
      userId: 'u1', email: 'dev@entri.me', role: 'USER', mustResetPassword: false, impersonatorId: 'admin',
    });
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('refuses %s', async (method) => {
    await expect(getSession(request(method, '/api/projects/p1'))).rejects.toThrow(/Read-only/);
  });

  it('allows reads', async () => {
    await expect(getSession(request('GET', '/api/projects/p1'))).resolves.toMatchObject({ userId: 'u1' });
  });

  it.each([
    '/api/admin/users',
    '/api/admin',
    '/api/auth/github/connect',
    '/api/auth/gitlab/callback',
    '/api/git-providers/github/repos',
  ])('refuses GET %s', async (path) => {
    await expect(getSession(request('GET', path))).rejects.toThrow(/Not available/);
  });

  it('leaves an ordinary session alone', async () => {
    mockVerifySession.mockResolvedValue({ userId: 'u1', email: 'dev@entri.me', role: 'USER', mustResetPassword: false });
    await expect(getSession(request('DELETE', '/api/projects/p1'))).resolves.toMatchObject({ userId: 'u1' });
  });
});

describe('impersonationBlockReason', () => {
  it('lets the exit route through, so the admin can always leave', () => {
    expect(impersonationBlockReason('POST', '/api/auth/impersonation/exit')).toBeNull();
  });

  it('does not mistake a lookalike path for the admin API', () => {
    expect(impersonationBlockReason('GET', '/api/administrators')).toBeNull();
  });
});
