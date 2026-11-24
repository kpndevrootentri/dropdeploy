// A trailing slash, to check the link does not come out as `//invite`.
jest.mock('@/lib/config', () => ({ getConfig: () => ({ NEXT_PUBLIC_APP_URL: 'https://app.example.com/' }) }));

import { InviteService, RESET_TTL_MS, hashInviteToken } from '@/services/invite/invite.service';
import type { IInviteRepository } from '@/repositories/invite.repository';
import type { IUserRepository } from '@/repositories/user.repository';

function setup(user: { id: string; email: string; suspendedAt: Date | null } | null, canSendReset = true) {
  const invites = {
    add: jest.fn<Promise<void>, [{ userId: string; tokenHash: string; expiresAt: Date }]>(async () => {}),
    replaceUnused: jest.fn(async () => {}),
  };
  const users = { findByEmail: jest.fn(async () => user) };
  const email = {
    send: jest.fn<Promise<boolean>, [string, string, string, string]>(async () => true),
    canSendReset: jest.fn(async () => canSendReset),
  };
  const service = new InviteService(invites as unknown as IInviteRepository, users as unknown as IUserRepository, email);
  return { service, invites, email };
}

describe('InviteService.requestReset', () => {
  it('emails a one-hour, single-use link built from NEXT_PUBLIC_APP_URL', async () => {
    const { service, invites, email } = setup({ id: 'u1', email: 'dev@entri.me', suspendedAt: null });
    const before = Date.now();
    await service.requestReset(' dev@entri.me ');

    // Added, never replacing, so a stranger's request cannot cancel a pending invite.
    expect(invites.replaceUnused).not.toHaveBeenCalled();
    const { userId, tokenHash, expiresAt } = invites.add.mock.calls[0][0];
    expect(userId).toBe('u1');
    expect(expiresAt.getTime() - before).toBeGreaterThanOrEqual(RESET_TTL_MS);
    expect(expiresAt.getTime() - before).toBeLessThan(RESET_TTL_MS + 5_000);

    const [to, , text, kind] = email.send.mock.calls[0];
    expect(to).toBe('dev@entri.me');
    expect(kind).toBe('reset');
    const token = /https:\/\/app\.example\.com\/invite\/(\S+)/.exec(text)?.[1];
    expect(token && hashInviteToken(token)).toBe(tokenHash);
  });

  it('sends nothing, and issues no link, for an unknown or suspended address', async () => {
    for (const user of [null, { id: 'u2', email: 'gone@entri.me', suspendedAt: new Date() }]) {
      const { service, invites, email } = setup(user);
      await service.requestReset('gone@entri.me');
      expect(invites.add).not.toHaveBeenCalled();
      expect(email.send).not.toHaveBeenCalled();
    }
  });

  it('stores no link when the email is not sent, so a pending invite keeps working', async () => {
    const { service, invites, email } = setup({ id: 'u3', email: 'new@entri.me', suspendedAt: null });
    email.send.mockResolvedValue(false);
    await service.requestReset('new@entri.me');
    expect(email.send).toHaveBeenCalledTimes(1);
    expect(invites.add).not.toHaveBeenCalled();
  });

  it('issues no link once the daily forgot-password limit is reached', async () => {
    const { service, invites, email } = setup({ id: 'u4', email: 'dev@entri.me', suspendedAt: null }, false);
    await service.requestReset('dev@entri.me');
    expect(invites.add).not.toHaveBeenCalled();
    expect(email.send).not.toHaveBeenCalled();
  });
});
