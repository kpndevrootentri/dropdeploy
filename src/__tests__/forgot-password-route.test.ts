jest.mock('@/lib/email', () => ({ isEmailConfigured: jest.fn(() => false) }));
const mockRequestReset = jest.fn<Promise<void>, [string]>(async () => {});
jest.mock('@/services/invite', () => ({ inviteService: { requestReset: mockRequestReset } }));
// Outside a real request, run the deferred work at once.
jest.mock('next/server', () => ({ ...jest.requireActual('next/server'), after: (task: () => unknown) => task() }));

import { NextRequest } from 'next/server';
import { isEmailConfigured } from '@/lib/email';
import { checkForgotPasswordRateLimit } from '@/lib/rate-limit';
import { POST } from '@/app/api/auth/forgot-password/route';

function forgot(email: string): Promise<Response> {
  return POST(new NextRequest('http://localhost/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }));
}

describe('POST /api/auth/forgot-password', () => {
  it('says reset by email is unavailable while email is off, instead of a "check your email" that never arrives', async () => {
    const res = await forgot('dev@entri.me');
    expect(res.status).toBe(503);
    expect(mockRequestReset).not.toHaveBeenCalled();
  });

  it('asks for the reset when email is on', async () => {
    jest.mocked(isEmailConfigured).mockReturnValue(true);
    const res = await forgot('dev@entri.me');
    expect(res.status).toBe(200);
    expect(mockRequestReset).toHaveBeenCalledWith('dev@entri.me');
  });
});

describe('checkForgotPasswordRateLimit', () => {
  afterEach(() => jest.useRealTimers());

  it('allows one address 5 reset emails a day, even hours apart and from different IPs', () => {
    jest.useFakeTimers({ now: new Date('2026-11-24T00:00:00Z') });
    for (let request = 0; request < 5; request++) {
      expect(checkForgotPasswordRateLimit(`10.0.0.${request}`, 'victim@entri.me')).toBeNull();
      jest.advanceTimersByTime(2 * 60 * 60_000);
    }
    expect(checkForgotPasswordRateLimit('10.0.0.9', ' Victim@Entri.me ')?.status).toBe(429);
  });
});
