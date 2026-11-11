jest.mock('@/lib/docker-ops', () => ({ dockerOps: {}, containerNameFor: jest.fn() }));
jest.mock('@/services/deployment', () => ({ deploymentService: {} }));

import { AdminService } from '@/services/admin/admin.service';
import { hashInviteToken } from '@/services/invite/invite.service';
import type { IUserRepository, NewInvite } from '@/repositories/user.repository';
import type { IProjectRepository } from '@/repositories/project.repository';
import type { IDockerOps } from '@/lib/docker-ops';
import type { IDeploymentRepository } from '@/repositories/deployment.repository';
import type { IAdminActionRepository } from '@/repositories/admin-action.repository';
import { DEFAULT_PLATFORM_SETTINGS } from '@/services/platform-settings/platform-settings.service';

function setup(registered: string[], users: Record<string, { mustResetPassword: boolean }> = {}) {
  const userRepo = {
    createMany: jest.fn(async (invited: (NewInvite & { email: string })[], _passwordHash: string, _quotas?: unknown) =>
      invited.filter((i) => !registered.includes(i.email)).map(({ email }) => ({ id: `id-${email}`, email })),
    ),
    create: jest.fn(async (data: { email: string; invite?: NewInvite }) => ({ id: 'new-id', ...data })),
    findByEmail: jest.fn(async () => null),
    findById: jest.fn(async (id: string) =>
      (id === 'admin' ? { id, email: 'admin@entri.me' } : users[id] ? { id, ...users[id] } : null)),
  };
  const adminActions = { create: jest.fn(async () => ({})) };
  const settings = { get: async () => ({ ...DEFAULT_PLATFORM_SETTINGS, defaultProjectQuota: 3, defaultDomainQuota: 0 }) };
  const invites = { issue: jest.fn(async (userId: string) => `token-for-${userId}`) };
  const service = new AdminService(
    userRepo as unknown as IUserRepository,
    {} as IProjectRepository,
    {} as IDockerOps,
    {} as IDeploymentRepository,
    adminActions as unknown as IAdminActionRepository,
    settings,
    invites,
  );
  return { service, userRepo, invites, adminActions };
}

describe('AdminService.bulkInviteUsers', () => {
  it('invites new emails once, skips registered ones and reports invalid ones', async () => {
    const { service, userRepo } = setup(['old@entri.me']);
    const result = await service.bulkInviteUsers([' New@Entri.me ', 'new@entri.me', 'old@entri.me', 'not-an-email', ''], 'admin');
    expect(userRepo.createMany.mock.calls[0][0].map((i) => i.email)).toEqual(['new@entri.me', 'old@entri.me']);
    expect(userRepo.createMany.mock.calls[0][2]).toEqual({ projectQuota: 3, domainQuota: 0 });
    expect(result).toEqual({
      created: [{ email: 'new@entri.me', inviteToken: expect.any(String) }],
      skipped: ['old@entri.me'],
      invalid: ['not-an-email'],
    });
  });

  it('hands each account its invite in the same repository call that creates it', async () => {
    const { service, userRepo, invites } = setup([]);
    const { created } = await service.bulkInviteUsers(['a@entri.me', 'b@entri.me'], 'admin');
    const [invited] = userRepo.createMany.mock.calls[0];
    for (const { email, inviteToken } of created) {
      expect(invited.find((i) => i.email === email)?.tokenHash).toBe(hashInviteToken(inviteToken));
    }
    expect(new Set(created.map((c) => c.inviteToken)).size).toBe(2);
    expect(invites.issue).not.toHaveBeenCalled();
  });

  it('gives every account a password hash nobody knows, so none can sign in before accepting', async () => {
    const { service, userRepo } = setup([]);
    await service.bulkInviteUsers(['a@entri.me'], 'admin');
    const [, hash] = userRepo.createMany.mock.calls[0];
    expect(hash).toMatch(/^\$2[aby]\$/);
  });
});

describe('AdminService.bulkInviteUsers audit', () => {
  it('records one entry naming the admin and the invited emails, never an invite token', async () => {
    const { service, adminActions } = setup([]);
    const { created } = await service.bulkInviteUsers(['a@entri.me'], 'admin');
    expect(adminActions.create).toHaveBeenCalledTimes(1);
    const entry = (adminActions.create.mock.calls[0] as unknown[])[0];
    expect(entry).toMatchObject({ actorId: 'admin', actorEmail: 'admin@entri.me', action: 'USERS_BULK_CREATED' });
    expect(JSON.stringify(entry)).toContain('a@entri.me');
    expect(JSON.stringify(entry)).not.toContain(created[0].inviteToken);
  });
});

describe('AdminService.inviteUser', () => {
  it('creates the user and their invite in one repository call', async () => {
    const { service, userRepo } = setup([]);
    const { inviteToken } = await service.inviteUser('c@entri.me', 'admin');
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
