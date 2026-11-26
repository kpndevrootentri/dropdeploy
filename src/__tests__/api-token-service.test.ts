import {
  ApiTokenService,
  LAST_USED_INTERVAL_MS,
  MAX_ACTIVE_API_TOKENS,
  hashApiToken,
} from '@/services/api-token/api-token.service';
import type { ApiTokenOwner, ApiTokenRecord, IApiTokenRepository } from '@/repositories/api-token.repository';

type Row = ApiTokenRecord & { tokenHash: string };

function toRecord(row: Row): ApiTokenRecord {
  const copy: Partial<Row> = { ...row };
  delete copy.tokenHash;
  return copy as ApiTokenRecord;
}

const OWNER: ApiTokenOwner = { id: 'u1', email: 'dev@entri.me', role: 'USER', mustResetPassword: false, suspendedAt: null };

/** Mirrors ApiTokenRepository over an in-memory array. */
function setup() {
  const rows: Row[] = [];
  let owner: ApiTokenOwner = { ...OWNER };
  const touch = jest.fn(async (id: string, now: Date) => {
    rows.find((r) => r.id === id)!.lastUsedAt = now;
  });
  const repo: IApiTokenRepository = {
    create: async (data) => {
      const row: Row = { ...data, id: `t${rows.length + 1}`, lastUsedAt: null, revokedAt: null, createdAt: new Date() };
      rows.push(row);
      return toRecord(row);
    },
    countActive: async (userId, now) =>
      rows.filter((r) => r.userId === userId && !r.revokedAt && (!r.expiresAt || r.expiresAt > now)).length,
    listByUser: async (userId) => rows.filter((r) => r.userId === userId).map(toRecord),
    revoke: async (userId, id, now) => {
      const row = rows.find((r) => r.id === id && r.userId === userId);
      if (row && !row.revokedAt) row.revokedAt = now;
      return row !== undefined;
    },
    findByHash: async (tokenHash) => {
      const row = rows.find((r) => r.tokenHash === tokenHash);
      return row ? { ...toRecord(row), user: owner } : null;
    },
    touch,
  };
  const service = new ApiTokenService(repo);
  return { service, rows, touch, setOwner: (o: Partial<ApiTokenOwner>) => (owner = { ...owner, ...o }) };
}

describe('ApiTokenService', () => {
  it('returns an ent_ token once and stores only its sha256 hash and prefix', async () => {
    const { service, rows } = setup();
    const { token, record } = await service.create('u1', { name: 'CI', scope: 'DEPLOY', expiresInDays: 90 });

    expect(token).toMatch(/^ent_[A-Za-z0-9_-]{43}$/);
    expect(rows[0].tokenHash).toBe(hashApiToken(token));
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(record).not.toHaveProperty('tokenHash');
    expect(record.prefix).toBe(token.slice(0, 12));
    expect(record.expiresAt!.getTime() - Date.now()).toBeGreaterThan(90 * 86_400_000 - 5_000);
  });

  it('stores no expiry when asked for none', async () => {
    const { service } = setup();
    const { record } = await service.create('u1', { name: 'CI', scope: 'FULL', expiresInDays: null });
    expect(record.expiresAt).toBeNull();
  });

  it(`refuses a token beyond ${MAX_ACTIVE_API_TOKENS} active ones, and counts revoked ones out`, async () => {
    const { service } = setup();
    for (let i = 0; i < MAX_ACTIVE_API_TOKENS; i++) {
      await service.create('u1', { name: `t${i}`, scope: 'DEPLOY', expiresInDays: 30 });
    }
    await expect(service.create('u1', { name: 'one more', scope: 'DEPLOY', expiresInDays: 30 })).rejects.toThrow(
      /at most 20/,
    );
    await service.revoke('u1', 't1');
    await expect(service.create('u1', { name: 'one more', scope: 'DEPLOY', expiresInDays: 30 })).resolves.toBeDefined();
  });

  it('lists records without hashes', async () => {
    const { service } = setup();
    await service.create('u1', { name: 'CI', scope: 'DEPLOY', expiresInDays: 30 });
    const list = await service.list('u1');
    expect(list).toHaveLength(1);
    expect(list[0]).not.toHaveProperty('tokenHash');
  });

  it("will not revoke another user's token", async () => {
    const { service } = setup();
    await service.create('u1', { name: 'CI', scope: 'DEPLOY', expiresInDays: 30 });
    await expect(service.revoke('u2', 't1')).rejects.toThrow(/not found/);
  });

  it('verifies a live token and returns its owner and scope', async () => {
    const { service } = setup();
    const { token } = await service.create('u1', { name: 'CI', scope: 'DEPLOY', expiresInDays: 30 });
    await expect(service.verify(token)).resolves.toMatchObject({ user: { id: 'u1' }, token: { scope: 'DEPLOY' } });
  });

  it('rejects an unknown, revoked or expired token, or one whose owner is suspended', async () => {
    const { service, rows, setOwner } = setup();
    expect(await service.verify('ent_unknown')).toBeNull();

    const { token } = await service.create('u1', { name: 'CI', scope: 'DEPLOY', expiresInDays: 30 });
    await service.revoke('u1', 't1');
    expect(await service.verify(token)).toBeNull();

    const { token: expiring } = await service.create('u1', { name: 'CI', scope: 'DEPLOY', expiresInDays: 30 });
    rows[1].expiresAt = new Date(Date.now() - 1000);
    expect(await service.verify(expiring)).toBeNull();

    const { token: live } = await service.create('u1', { name: 'CI', scope: 'DEPLOY', expiresInDays: null });
    setOwner({ suspendedAt: new Date() });
    expect(await service.verify(live)).toBeNull();
  });

  it('records use at most once per interval, without waiting for the write', async () => {
    const { service, rows, touch } = setup();
    const { token } = await service.create('u1', { name: 'CI', scope: 'DEPLOY', expiresInDays: 30 });

    await service.verify(token);
    await service.verify(token);
    expect(touch).toHaveBeenCalledTimes(1);

    rows[0].lastUsedAt = new Date(Date.now() - LAST_USED_INTERVAL_MS - 1000);
    await service.verify(token);
    expect(touch).toHaveBeenCalledTimes(2);
  });

  it('still verifies when recording use fails', async () => {
    const { service, touch } = setup();
    const { token } = await service.create('u1', { name: 'CI', scope: 'DEPLOY', expiresInDays: 30 });
    touch.mockRejectedValueOnce(new Error('db down'));
    await expect(service.verify(token)).resolves.not.toBeNull();
  });
});
