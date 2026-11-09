jest.mock('@/lib/docker-ops', () => ({ dockerOps: {}, containerNameFor: jest.fn() }));
jest.mock('@/services/deployment', () => ({ deploymentService: {} }));

import { AdminService } from '@/services/admin/admin.service';
import type { IUserRepository } from '@/repositories/user.repository';
import type { IProjectRepository } from '@/repositories/project.repository';
import type { IDockerOps } from '@/lib/docker-ops';

function setup(registered: string[]) {
  const userRepo = {
    createMany: jest.fn(async (emails: string[], _passwordHash: string) =>
      emails.filter((e) => !registered.includes(e)).map((email) => ({ id: `id-${email}`, email })),
    ),
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
    expect(userRepo.createMany).toHaveBeenCalledWith(['new@entri.me', 'old@entri.me'], expect.any(String));
    expect(result).toEqual({
      created: [{ email: 'new@entri.me', inviteToken: 'token-for-id-new@entri.me' }],
      skipped: ['old@entri.me'],
      invalid: ['not-an-email'],
    });
  });

  it('gives every account a password hash nobody knows, so none can sign in before accepting', async () => {
    const { service, userRepo } = setup([]);
    await service.bulkInviteUsers(['a@entri.me']);
    const [, hash] = userRepo.createMany.mock.calls[0];
    expect(hash).toMatch(/^\$2[aby]\$/);
  });
});
