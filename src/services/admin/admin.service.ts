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
import { inviteService, newInviteToken, type InviteService } from '@/services/invite';
import { getConfig } from '@/lib/config';
import { planRedeployAll, type RedeployCandidate, type RedeployFilters } from './redeploy-plan';

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

export interface RedeployAllResult {
  /** Worker builds that run at once (BULLMQ_CONCURRENCY); the rest wait in the queue. */
  concurrency: number;
  eligible: { id: string; name: string; ownerEmail: string; type: string; source: string }[];
  skipped: { id: string; name: string; reason: string }[];
  /** Present only when the deploys were actually queued. */
  results?: { id: string; name: string; outcome: 'queued' | 'failed'; error?: string }[];
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
    const { token, tokenHash, expiresAt } = newInviteToken();
    const user = await this.userRepo.create({
      email,
      passwordHash: await unusablePasswordHash(),
      role: 'USER',
      mustResetPassword: true,
      invite: { tokenHash, expiresAt },
    });
    return { user: toPublicUser(user), inviteToken: token };
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
    // Tokens for emails that turn out to be registered are simply never stored.
    const tokens = new Map(valid.map((email) => [email, newInviteToken()]));
    const users = valid.length
      ? await this.userRepo.createMany([...tokens].map(([email, t]) => ({ email, tokenHash: t.tokenHash, expiresAt: t.expiresAt })), await unusablePasswordHash())
      : [];
    const created = users.map((u) => ({ email: u.email, inviteToken: tokens.get(u.email)!.token }));
    const createdSet = new Set(users.map((u) => u.email));
    return { created, skipped: valid.filter((e) => !createdSet.has(e)), invalid };
  }

  /**
   * A fresh invite link for a user who has not chosen a password yet, e.g.
   * when the first one expired or went to the wrong person. Earlier unused
   * links stop working.
   */
  async reissueInvite(userId: string): Promise<string> {
    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundError('User');
    if (!user.mustResetPassword) throw new ConflictError('This user has already chosen a password');
    return this.invites.issue(userId);
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

  /**
   * Rebuilds every repository project that matches the filters, or with
   * `dryRun` only lists what would happen. Deploys go through the normal
   * queue, one at a time here, so the worker's concurrency caps the load on
   * the host that also serves every site.
   */
  async redeployAll(filters: RedeployFilters, dryRun: boolean): Promise<RedeployAllResult> {
    const { prisma } = await import('@/lib/prisma');
    const [projects, active] = await Promise.all([
      this.projectRepo.findAll(),
      prisma.deployment.findMany({
        where: { status: { in: ['QUEUED', 'BUILDING'] } },
        select: { projectId: true },
      }),
    ]);
    const candidates: RedeployCandidate[] = projects.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      type: p.type,
      source: p.source,
      githubUrl: p.githubUrl,
      userId: p.userId,
      ownerEmail: p.user.email,
      lastStatus: p.deployments[0]?.status ?? null,
    }));
    const { eligible, skipped } = planRedeployAll(candidates, new Set(active.map((d) => d.projectId)), filters);

    const result: RedeployAllResult = {
      concurrency: getConfig().BULLMQ_CONCURRENCY,
      eligible: eligible.map((p) => ({ id: p.id, name: p.name, ownerEmail: p.ownerEmail, type: p.type, source: p.source })),
      skipped: skipped.map(({ project, reason }) => ({ id: project.id, name: project.name, reason })),
    };
    if (dryRun) return result;

    result.results = [];
    for (const project of eligible) {
      try {
        await deploymentService.createDeployment(project.id, project.userId);
        result.results.push({ id: project.id, name: project.name, outcome: 'queued' });
      } catch (err) {
        result.results.push({
          id: project.id,
          name: project.name,
          outcome: 'failed',
          error: err instanceof Error ? err.message : 'Failed to queue',
        });
      }
    }
    return result;
  }
}

export const adminService = new AdminService(userRepository, projectRepository, dockerOps, inviteService);
