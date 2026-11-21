jest.mock('@/lib/email', () => ({ sendEmail: jest.fn(async () => true), isEmailConfigured: jest.fn(() => true) }));
// A trailing slash, to check the link does not come out as `//invite`.
jest.mock('@/lib/config', () => ({ getConfig: () => ({ NEXT_PUBLIC_APP_URL: 'https://app.example.com/' }) }));

import { isEmailConfigured, sendEmail } from '@/lib/email';
import { InviteService, RESET_TTL_MS, hashInviteToken } from '@/services/invite/invite.service';
import type { IInviteRepository } from '@/repositories/invite.repository';
import type { IUserRepository } from '@/repositories/user.repository';

function setup(user: { id: string; email: string; suspendedAt: Date | null } | null) {
  const invites = {
    replaceUnused: jest.fn<Promise<void>, [{ userId: string; tokenHash: string; expiresAt: Date }]>(async () => {}),
  };
  const users = { findByEmail: jest.fn(async () => user) };
  const service = new InviteService(invites as unknown as IInviteRepository, users as unknown as IUserRepository);
  return { service, invites };
}

beforeEach(() => {
  jest.mocked(sendEmail).mockClear();
  jest.mocked(isEmailConfigured).mockReturnValue(true);
});

describe('InviteService.requestReset', () => {
  it('emails a one-hour, single-use link built from NEXT_PUBLIC_APP_URL', async () => {
    const { service, invites } = setup({ id: 'u1', email: 'dev@entri.me', suspendedAt: null });
    const before = Date.now();
    await service.requestReset(' dev@entri.me ');

    const { userId, tokenHash, expiresAt } = invites.replaceUnused.mock.calls[0][0];
    expect(userId).toBe('u1');
    expect(expiresAt.getTime() - before).toBeGreaterThanOrEqual(RESET_TTL_MS);
    expect(expiresAt.getTime() - before).toBeLessThan(RESET_TTL_MS + 5_000);

    const [to, , text] = jest.mocked(sendEmail).mock.calls[0];
    expect(to).toBe('dev@entri.me');
    const token = /https:\/\/app\.example\.com\/invite\/(\S+)/.exec(text)?.[1];
    expect(token && hashInviteToken(token)).toBe(tokenHash);
  });

  it('sends nothing, and issues no link, for an unknown or suspended address', async () => {
    for (const user of [null, { id: 'u2', email: 'gone@entri.me', suspendedAt: new Date() }]) {
      const { service, invites } = setup(user);
      await service.requestReset('gone@entri.me');
      expect(invites.replaceUnused).not.toHaveBeenCalled();
    }
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('issues no link when email is off, so pending links keep working', async () => {
    jest.mocked(isEmailConfigured).mockReturnValue(false);
    const { service, invites } = setup({ id: 'u3', email: 'new@entri.me', suspendedAt: null });
    await service.requestReset('new@entri.me');
    expect(invites.replaceUnused).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
