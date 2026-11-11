const mockVerifySession = jest.fn();
const mockVerifyToken = jest.fn();
const mockEventCreate = jest.fn(async () => ({}));
jest.mock('@/services/auth', () => ({
  authService: {
    verifySession: (t: string) => mockVerifySession(t),
    verifyToken: (t: string) => mockVerifyToken(t),
  },
}));
jest.mock('@/lib/prisma', () => ({ prisma: { platformEvent: { create: () => mockEventCreate() } } }));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/auth/impersonation/exit/route';

const inAnHour = Math.floor(Date.now() / 1000) + 3600;

function exit(cookie: string): Promise<Response> {
  return POST(new NextRequest('http://localhost:3001/api/auth/impersonation/exit', { method: 'POST', headers: { cookie } }));
}

function setCookie(res: Response, name: string): string | undefined {
  return res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
}

describe('POST /api/auth/impersonation/exit', () => {
  beforeEach(() => {
    mockEventCreate.mockClear();
    mockVerifySession.mockImplementation(async (t: string) => {
      if (t === 'admin-token') return { userId: 'admin', email: 'admin@entri.me', role: 'CONTRIBUTOR', mustResetPassword: false };
      throw new Error('revoked');
    });
    mockVerifyToken.mockImplementation(async (t: string) => {
      if (t === 'admin-token') return { sub: 'admin', exp: inAnHour };
      if (t === 'view-token') return { sub: 'u1', email: 'dev@entri.me', impersonatorId: 'admin', exp: inAnHour };
      if (t === 'someone-elses-view') return { sub: 'u2', email: 'x@entri.me', impersonatorId: 'attacker', exp: inAnHour };
      throw new Error('invalid');
    });
  });

  it("restores the admin's own session and records the exit", async () => {
    const res = await exit('auth-token=view-token; admin-restore=admin-token');
    expect(res.status).toBe(200);
    expect(setCookie(res, 'auth-token')).toMatch(/^auth-token=admin-token;/);
    expect(setCookie(res, 'admin-restore')).toMatch(/Max-Age=0/);
    expect(mockEventCreate).toHaveBeenCalledTimes(1);
  });

  it('still restores after the 30-minute view has expired', async () => {
    const res = await exit('admin-restore=admin-token');
    expect(setCookie(res, 'auth-token')).toMatch(/^auth-token=admin-token;/);
  });

  it('signs out instead of trusting a restore cookie that does not match the current view', async () => {
    const res = await exit('auth-token=someone-elses-view; admin-restore=admin-token');
    expect(res.status).toBe(401);
    expect(setCookie(res, 'auth-token')).toMatch(/^auth-token=;/);
    expect(mockEventCreate).not.toHaveBeenCalled();
  });

  it('signs out when the saved admin session is no longer valid', async () => {
    const res = await exit('auth-token=view-token; admin-restore=stale');
    expect(res.status).toBe(401);
    expect(setCookie(res, 'auth-token')).toMatch(/^auth-token=;/);
  });
});
