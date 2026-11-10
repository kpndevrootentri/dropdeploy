jest.mock('@/lib/docker-ops', () => ({ dockerOps: {}, containerNameFor: jest.fn() }));
jest.mock('@/services/deployment', () => ({ deploymentService: {} }));

import { AdminService } from '@/services/admin/admin.service';
import { hashInviteToken } from '@/services/invite/invite.service';
import type { IUserRepository, NewInvite } from '@/repositories/user.repository';
import type { IProjectRepository } from '@/repositories/project.repository';
import type { IDockerOps } from '@/lib/docker-ops';

function setup(registered: string[], users: Record<string, { mustResetPassword: boolean }> = {}) {
  const userRepo = {
    createMany: jest.fn(async (invited: (NewInvite & { email: string })[], _passwordHash: string) =>
      invited.filter((i) => !registered.includes(i.email)).map(({ email }) => ({ id: `id-${email}`, email })),
    ),
    create: jest.fn(async (data: { email: string; invite?: NewInvite }) => ({ id: 'new-id', ...data })),
    findByEmail: jest.fn(async () => null),
    findById: jest.fn(async (id: string) => (users[id] ? { id, ...users[id] } : null)),
  };
  const invites = { issue: jest.fn(async (userId: string) => `token-for-${userId}`) };
  const service = new AdminService(
    userRepo as unknown as IUserRepository,
    {} as IProjectRepository,
    {} as IDockerOps,
    invites,
  );
  return { service, userRepo, invites };
}

describe('AdminService.bulkInviteUsers', () => {
  it('invites new emails once, skips registered ones and reports invalid ones', async () => {
    const { service, userRepo } = setup(['old@entri.me']);
    const result = await service.bulkInviteUsers([' New@Entri.me ', 'new@entri.me', 'old@entri.me', 'not-an-email', '']);
    expect(userRepo.createMany.mock.calls[0][0].map((i) => i.email)).toEqual(['new@entri.me', 'old@entri.me']);
    expect(result).toEqual({
      created: [{ email: 'new@entri.me', inviteToken: expect.any(String) }],
      skipped: ['old@entri.me'],
      invalid: ['not-an-email'],
    });
  });

  it('hands each account its invite in the same repository call that creates it', async () => {
    const { service, userRepo, invites } = setup([]);
    const { created } = await service.bulkInviteUsers(['a@entri.me', 'b@entri.me']);
    const [invited] = userRepo.createMany.mock.calls[0];
    for (const { email, inviteToken } of created) {
      expect(invited.find((i) => i.email === email)?.tokenHash).toBe(hashInviteToken(inviteToken));
    }
    expect(new Set(created.map((c) => c.inviteToken)).size).toBe(2);
    expect(invites.issue).not.toHaveBeenCalled();
  });

  it('gives every account a password hash nobody knows, so none can sign in before accepting', async () => {
    const { service, userRepo } = setup([]);
    await service.bulkInviteUsers(['a@entri.me']);
    const [, hash] = userRepo.createMany.mock.calls[0];
    expect(hash).toMatch(/^\$2[aby]\$/);
  });
});

describe('AdminService.inviteUser', () => {
  it('creates the user and their invite in one repository call', async () => {
    const { service, userRepo } = setup([]);
    const { inviteToken } = await service.inviteUser('c@entri.me');
    expect(userRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      email: 'c@entri.me',
      mustResetPassword: true,
      invite: { tokenHash: hashInviteToken(inviteToken), expiresAt: expect.any(Date) },
    }));
  });
});

describe('AdminService.reissueInvite', () => {
  it('issues a fresh link for a user who has not chosen a password', async () => {
    const { service, invites } = setup([], { pending: { mustResetPassword: true } });
    await expect(service.reissueInvite('pending')).resolves.toBe('token-for-pending');
    expect(invites.issue).toHaveBeenCalledWith('pending');
  });

  it('refuses once the user has chosen their own password, and for unknown users', async () => {
    const { service, invites } = setup([], { active: { mustResetPassword: false } });
    await expect(service.reissueInvite('active')).rejects.toThrow(/already chosen/);
    await expect(service.reissueInvite('ghost')).rejects.toThrow(/not found/i);
    expect(invites.issue).not.toHaveBeenCalled();
  });
});
