import { randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { User, UserRole, Project } from '@prisma/client';
import type { IUserRepository } from '@/repositories/user.repository';
import { userRepository } from '@/repositories/user.repository';
import type { IProjectRepository } from '@/repositories/project.repository';
import { projectRepository } from '@/repositories/project.repository';
import { dockerOps, containerNameFor, type IDockerOps, type ContainerInfo } from '@/lib/docker-ops';
import { deploymentService } from '@/services/deployment';
import { NotFoundError, ValidationError, ConflictError } from '@/lib/errors';
import { inviteService, type InviteService } from '@/services/invite';

import { SALT_ROUNDS } from '@/services/auth/auth.service';

/** One row of the admin user table. Deliberately excludes `passwordHash`. */
export interface AdminUserRow {
  id: string;
  email: string;
  role: UserRole;
  projectQuota: number;
  domainQuota: number;
  mustResetPassword: boolean;
  createdAt: Date;
  updatedAt: Date;
  _count: { projects: number; customDomains: number };
}

/** A user as the admin API returns it: never the password hash or token version. */
export type PublicUser = Omit<User, 'passwordHash' | 'tokenVersion'>;

/**
 * Strips credentials from a user row before it leaves the service. Every
 * admin method that returns a user goes through this — Prisma's default is to
 * return every scalar, `passwordHash` included.
 */
function toPublicUser(user: User): PublicUser {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { passwordHash, tokenVersion, ...rest } = user;
  return rest;
}

export interface BulkInviteResult {
  /** New accounts, each with the one-time token for its invite link. */
  created: { email: string; inviteToken: string }[];
  /** Already registered. */
  skipped: string[];
  invalid: string[];
}

/** A hash of random bytes nobody ever sees: the account cannot sign in until its invite is accepted. */
async function unusablePasswordHash(): Promise<string> {
  return bcrypt.hash(randomBytes(32).toString('hex'), SALT_ROUNDS);
}

/** A password for an admin to hand over once; the user must replace it at next sign-in. */
export function generatePassword(): string {
  return randomBytes(12).toString('base64url');
}

export class AdminService {
  constructor(
    private readonly userRepo: IUserRepository,
    private readonly projectRepo: IProjectRepository,
    private readonly docker: IDockerOps,
    private readonly invites: Pick<InviteService, 'issue'>,
  ) {}

  /**
   * Users for the admin table, with both quotas and both usage counts.
   *
   * NOTE the explicit `select`. This list is serialised straight to the admin
   * page, and a bare `findMany` returns every scalar column — including
   * `passwordHash`. Shipping every user's bcrypt hash to a browser is
   * Security Assessment finding #23; the select is what prevents it, so do not
   * replace it with `include` for convenience.
   *
   * Custom domains hang off Project, not User, so Prisma's `_count` cannot
   * reach them in one query. At this scale a second query and a tally is
   * cheaper and clearer than the join gymnastics that would avoid it.
   */
  async listAllUsers(): Promise<AdminUserRow[]> {
    const { prisma } = await import('@/lib/prisma');

    const [users, domains] = await Promise.all([
      prisma.user.findMany({
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          email: true,
          role: true,
          projectQuota: true,
          domainQuota: true,
          mustResetPassword: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { projects: true } },
        },
      }),
      prisma.customDomain.findMany({ select: { project: { select: { userId: true } } } }),
    ]);

    const domainsPerUser = new Map<string, number>();
    for (const { project } of domains) {
      domainsPerUser.set(project.userId, (domainsPerUser.get(project.userId) ?? 0) + 1);
    }

    return users.map((user) => ({
      ...user,
      _count: { projects: user._count.projects, customDomains: domainsPerUser.get(user.id) ?? 0 },
    }));
  }

  async changeUserRole(userId: string, role: UserRole, actorId: string): Promise<PublicUser> {
    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundError('User');

    // If demoting a contributor, ensure at least one other contributor remains
    if (role !== 'CONTRIBUTOR' && user.role === 'CONTRIBUTOR') {
      const { prisma } = await import('@/lib/prisma');
      const contributorCount = await prisma.user.count({ where: { role: 'CONTRIBUTOR' } });
      if (contributorCount <= 1) {
        throw new ConflictError('Cannot remove the last CONTRIBUTOR');
      }
    }

    return toPublicUser(await this.userRepo.updateRole(userId, role));
  }

  async deleteUser(userId: string, actorId: string): Promise<void> {
    if (userId === actorId) {
      throw new ValidationError('Cannot delete your own account');
    }
    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundError('User');

    if (user.role === 'CONTRIBUTOR') {
      const { prisma } = await import('@/lib/prisma');
      const contributorCount = await prisma.user.count({ where: { role: 'CONTRIBUTOR' } });
      if (contributorCount <= 1) {
        throw new ConflictError('Cannot delete the last CONTRIBUTOR');
      }
    }

    // The DB cascade drops the project rows but not their containers, images or files.
    for (const project of await this.projectRepo.findByUserId(userId)) {
      await this.docker.removeProjectResources(project.slug);
    }
    await this.userRepo.delete(userId);
  }

  /**
   * Creates a USER who cannot sign in until they open their invite link and
   * choose a password. The token is returned once and never stored in clear.
   */
  async inviteUser(email: string): Promise<{ user: PublicUser; inviteToken: string }> {
    const existing = await this.userRepo.findByEmail(email);
    if (existing) throw new ConflictError('Email already registered');
    const user = await this.userRepo.create({
      email,
      passwordHash: await unusablePasswordHash(),
      role: 'USER',
      mustResetPassword: true,
    });
    return { user: toPublicUser(user), inviteToken: await this.invites.issue(user.id) };
  }

  /**
   * Invites many users at once, each with their own one-time link. Existing
   * accounts are skipped, never changed.
   */
  async bulkInviteUsers(input: string[]): Promise<BulkInviteResult> {
    const emails = [...new Set(input.map((e) => e.trim().toLowerCase()).filter(Boolean))];
    const isEmail = (e: string): boolean => z.string().email().safeParse(e).success;
    const valid = emails.filter(isEmail);
    const invalid = emails.filter((e) => !isEmail(e));
    const users = valid.length ? await this.userRepo.createMany(valid, await unusablePasswordHash()) : [];
    const created = [];
    for (const user of users) {
      created.push({ email: user.email, inviteToken: await this.invites.issue(user.id) });
    }
    const createdSet = new Set(users.map((u) => u.email));
    return { created, skipped: valid.filter((e) => !createdSet.has(e)), invalid };
  }

  async listAllProjects(): Promise<(Project & { user: { id: string; email: string; role: string }; deployments: { id: string; status: string; createdAt: Date }[] })[]> {
    return this.projectRepo.findAll();
  }

  async transferOwnership(projectId: string, newOwnerId: string): Promise<Project> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) throw new NotFoundError('Project');
    const newOwner = await this.userRepo.findById(newOwnerId);
    if (!newOwner) throw new NotFoundError('User');
    return this.projectRepo.transferOwner(projectId, newOwnerId);
  }

  async deleteProject(projectId: string): Promise<void> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) throw new NotFoundError('Project');
    await this.docker.removeProjectResources(project.slug);
    await this.projectRepo.delete(projectId);
  }

  async getProjectContainerInfo(projectId: string): Promise<ContainerInfo | null> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) throw new NotFoundError('Project');
    return this.docker.containerInfo(containerNameFor(project.slug));
  }

  async stopContainer(projectId: string): Promise<void> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) throw new NotFoundError('Project');
    await this.docker.stopContainer(containerNameFor(project.slug));
  }

  async restartContainer(projectId: string): Promise<void> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) throw new NotFoundError('Project');
    await this.docker.restartContainer(containerNameFor(project.slug));
  }

  async updateUserQuota(userId: string, quota: number): Promise<PublicUser> {
    if (quota < 0) throw new ValidationError('Quota must be a non-negative integer');
    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundError('User');
    return toPublicUser(await this.userRepo.updateQuota(userId, quota));
  }

  /** Custom-domain allowance. Zero means the user cannot add any. */
  async updateUserDomainQuota(userId: string, quota: number): Promise<PublicUser> {
    if (quota < 0) throw new ValidationError('Quota must be a non-negative integer');
    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundError('User');
    return toPublicUser(await this.userRepo.updateDomainQuota(userId, quota));
  }

  /**
   * Sets a password the admin hands over. With no password given, one is
   * generated and returned so the admin can copy it once.
   */
  async resetUserPassword(userId: string, newPassword?: string): Promise<{ generatedPassword?: string }> {
    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundError('User');
    const password = newPassword ?? generatePassword();
    if (password.length < 8) throw new ValidationError('Password must be at least 8 characters');
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    // The admin now knows this password, so the user must replace it on next
    // sign-in; setPassword also signs them out everywhere.
    await this.userRepo.setPassword(userId, passwordHash, true);
    return newPassword === undefined ? { generatedPassword: password } : {};
  }

  async forceRedeploy(projectId: string, actorId: string): Promise<void> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) throw new NotFoundError('Project');
    // Bypass ownership check by delegating to deploymentService with the project's actual owner
    await deploymentService.createDeployment(projectId, project.userId);
  }
}

export const adminService = new AdminService(userRepository, projectRepository, dockerOps, inviteService);
