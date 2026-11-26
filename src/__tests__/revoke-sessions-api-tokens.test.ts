const mockTransaction = jest.fn(async (ops: unknown) => ops);
const tx = {
  user: { update: jest.fn(async (args: unknown) => ({ id: 'u1', args })) },
  apiToken: { updateMany: jest.fn(async (args: unknown) => ({ count: 1, args })) },
};
jest.mock('@/lib/prisma', () => ({
  prisma: {
    // Array form: the ops as built below. Callback form: run it with the tx mock.
    $transaction: (ops: unknown) => (typeof ops === 'function' ? ops(tx) : mockTransaction(ops)),
    user: { update: (args: unknown) => ({ model: 'user', args }) },
    inviteToken: { deleteMany: (args: unknown) => ({ model: 'inviteToken', args }) },
    apiToken: { updateMany: (args: unknown) => ({ model: 'apiToken', args }) },
  },
}));

import { UserRepository } from '@/repositories/user.repository';

const revokeTokens = {
  model: 'apiToken',
  args: { where: { userId: 'u1', revokedAt: null }, data: { revokedAt: expect.any(Date) } },
};

beforeEach(() => {
  mockTransaction.mockClear();
  tx.user.update.mockClear();
  tx.apiToken.updateMany.mockClear();
});

describe('UserRepository.revokeSessions', () => {
  it('ends every login and revokes the API tokens in one transaction', async () => {
    await new UserRepository().revokeSessions('u1');
    expect(mockTransaction).toHaveBeenCalledWith([
      { model: 'user', args: { where: { id: 'u1' }, data: { tokenVersion: { increment: 1 } } } },
      revokeTokens,
    ]);
  });
});

describe('UserRepository.setPassword', () => {
  it('revokes the API tokens with the sessions, so a stolen token does not outlive the password change', async () => {
    await new UserRepository().setPassword('u1', 'hash');
    const ops = mockTransaction.mock.calls[0][0] as unknown[];
    expect(ops).toContainEqual(revokeTokens);
    expect(ops).toHaveLength(3);
  });
});

describe('UserRepository.setSuspended', () => {
  const tokenRevoke = { where: { userId: 'u1', revokedAt: null }, data: { revokedAt: expect.any(Date) } };

  it("revokes the user's API tokens when suspending, inside the caller's transaction", async () => {
    await new UserRepository().setSuspended('u1', true, tx as never);
    expect(tx.apiToken.updateMany).toHaveBeenCalledWith(tokenRevoke);
  });

  it('does not touch API tokens when reinstating', async () => {
    await new UserRepository().setSuspended('u1', false, tx as never);
    expect(tx.user.update).toHaveBeenCalled();
    expect(tx.apiToken.updateMany).not.toHaveBeenCalled();
  });

  it('opens its own transaction when the caller has none', async () => {
    await new UserRepository().setSuspended('u1', true);
    expect(tx.user.update).toHaveBeenCalled();
    expect(tx.apiToken.updateMany).toHaveBeenCalledWith(tokenRevoke);
  });
});
