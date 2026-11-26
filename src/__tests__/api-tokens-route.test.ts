const mockCreate = jest.fn();
const mockConfirmPassword = jest.fn();
jest.mock('@/lib/get-session', () => ({ getSession: async () => ({ userId: 'u1', via: 'jwt' }) }));
jest.mock('@/services/api-token', () => ({
  apiTokenService: { create: (...args: unknown[]) => mockCreate(...args) },
}));
jest.mock('@/services/auth', () => ({
  authService: { confirmPassword: (...args: unknown[]) => mockConfirmPassword(...args) },
}));
const mockLimit = jest.fn((): unknown => null);
jest.mock('@/lib/rate-limit', () => ({ checkPasswordChangeRateLimit: () => mockLimit() }));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/tokens/route';

function post(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3001/api/tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/tokens', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({ token: 'ent_x', record: { id: 't1' } });
    mockConfirmPassword.mockReset();
    mockConfirmPassword.mockResolvedValue(undefined);
  });

  it('defaults to a Deploy only token that expires in 90 days', async () => {
    const res = await POST(post({ name: '  Claude Desktop  ', password: 'pw' }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ success: true, data: { token: 'ent_x', record: { id: 't1' } } });
    expect(mockConfirmPassword).toHaveBeenCalledWith('u1', 'pw');
    // The password is checked, never passed on.
    expect(mockCreate).toHaveBeenCalledWith('u1', { name: 'Claude Desktop', scope: 'DEPLOY', expiresInDays: 90 });
  });

  it('accepts Full access with no expiry', async () => {
    const res = await POST(post({ name: 'CI', scope: 'FULL', expiresInDays: null, password: 'pw' }));
    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith('u1', { name: 'CI', scope: 'FULL', expiresInDays: null });
  });

  it.each([
    [{ name: '' }, /Enter a name/],
    [{ name: '   ' }, /Enter a name/],
    [{ name: 'x'.repeat(61) }, /60 characters/],
    [{ name: 'CI', scope: 'ADMIN' }, /DEPLOY|FULL/],
    [{ name: 'CI', expiresInDays: 7 }, /30, 90 or 365/],
    [{ name: 'CI', expiresInDays: '90' }, /30, 90 or 365/],
    [{}, /expected string, received undefined/],
    [{ name: 'CI' }, /expected string, received undefined/],
    [{ name: 'CI', password: '' }, /Enter your password/],
  ])('rejects %j', async (body, message) => {
    const res = await POST(post(body));
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(message);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('stops at the password rate limit before checking the password', async () => {
    const { NextResponse } = await import('next/server');
    mockLimit.mockReturnValueOnce(NextResponse.json({ success: false }, { status: 429 }));
    const res = await POST(post({ name: 'CI', password: 'guess' }));
    expect(res.status).toBe(429);
    expect(mockConfirmPassword).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('creates nothing when the password is wrong, so a stolen login cannot mint a token', async () => {
    const { ValidationError } = await import('@/lib/errors');
    mockConfirmPassword.mockRejectedValue(new ValidationError('Current password is incorrect'));
    const res = await POST(post({ name: 'CI', scope: 'FULL', expiresInDays: null, password: 'guess' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/password is incorrect/);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
