import { InviteService, INVALID_INVITE_MESSAGE, INVITE_TTL_MS, hashInviteToken } from '@/services/invite/invite.service';
import type { IInviteRepository } from '@/repositories/invite.repository';
import type { IUserRepository } from '@/repositories/user.repository';

interface Row { userId: string; tokenHash: string; expiresAt: Date; usedAt: Date | null }

/** Mirrors InviteRepository: consume succeeds only for an unused, unexpired hash. */
function setup() {
  const rows: Row[] = [];
  const invites: IInviteRepository = {
    replaceUnused: async (data) => {
      rows.splice(0, rows.length, ...rows.filter((r) => r.userId !== data.userId || r.usedAt));
      rows.push({ ...data, usedAt: null });
    },
    consume: async (tokenHash, now) => {
      const row = rows.find((r) => r.tokenHash === tokenHash && !r.usedAt && r.expiresAt > now);
      if (!row) return null;
      row.usedAt = now;
      return row.userId;
    },
  };
  const users = { setPassword: jest.fn(async () => ({})) };
  const service = new InviteService(invites, users as unknown as IUserRepository);
  return { service, rows, users };
}

describe('InviteService', () => {
  it('stores only a hash of the token, expiring in 7 days', async () => {
    const { service, rows } = setup();
    const token = await service.issue('u1');
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashInviteToken(token));
    expect(rows[0].tokenHash).not.toContain(token);
    expect(rows[0].expiresAt.getTime() - Date.now()).toBeGreaterThan(INVITE_TTL_MS - 5_000);
  });

  it('sets the password exactly once, then rejects the same link', async () => {
    const { service, users } = setup();
    const token = await service.issue('u1');
    await service.accept(token, 'chosen-password');
    expect(users.setPassword).toHaveBeenCalledTimes(1);
    expect(users.setPassword).toHaveBeenCalledWith('u1', expect.stringMatching(/^\$2[aby]\$/), false);

    await expect(service.accept(token, 'another-password')).rejects.toThrow(INVALID_INVITE_MESSAGE);
    expect(users.setPassword).toHaveBeenCalledTimes(1);
  });

  it('a new link for the same user replaces the unused one', async () => {
    const { service, users } = setup();
    const first = await service.issue('u1');
    const second = await service.issue('u1');
    await expect(service.accept(first, 'chosen-password')).rejects.toThrow(INVALID_INVITE_MESSAGE);
    await service.accept(second, 'chosen-password');
    expect(users.setPassword).toHaveBeenCalledTimes(1);
  });

  it('rejects an expired link', async () => {
    const { service, rows, users } = setup();
    const token = await service.issue('u1');
    rows[0].expiresAt = new Date(Date.now() - 1000);
    await expect(service.accept(token, 'chosen-password')).rejects.toThrow(INVALID_INVITE_MESSAGE);
    expect(users.setPassword).not.toHaveBeenCalled();
  });

  it('answers unknown, expired and used links identically, so a link reveals nothing', async () => {
    const { service, rows } = setup();
    const used = await service.issue('u1');
    await service.accept(used, 'chosen-password');
    const expired = await service.issue('u2');
    rows[1].expiresAt = new Date(0);

    const messages = await Promise.all(
      ['not-a-real-token-at-all', expired, used].map((t) =>
        service.accept(t, 'chosen-password').then(() => 'accepted', (e: Error) => e.message),
      ),
    );
    expect(new Set(messages)).toEqual(new Set([INVALID_INVITE_MESSAGE]));
  });

  it('rejects a short password without spending the link', async () => {
    const { service, rows } = setup();
    const token = await service.issue('u1');
    await expect(service.accept(token, 'short')).rejects.toThrow('at least 8');
    expect(rows[0].usedAt).toBeNull();
  });
});
