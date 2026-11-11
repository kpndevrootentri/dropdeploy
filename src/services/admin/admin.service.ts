import * as bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { User, UserRole, Project, Prisma, AdminAction } from '@prisma/client';
import type { IUserRepository } from '@/repositories/user.repository';
import { userRepository } from '@/repositories/user.repository';
import type { IProjectRepository } from '@/repositories/project.repository';
import { projectRepository } from '@/repositories/project.repository';
import { deploymentRepository, type IDeploymentRepository } from '@/repositories/deployment.repository';
import { dockerOps, containerNameFor, type IDockerOps, type ContainerInfo } from '@/lib/docker-ops';
import { deploymentService } from '@/services/deployment';
import { AppError, NotFoundError, ValidationError, ConflictError } from '@/lib/errors';
import {
  adminActionRepository,
  type CreateAdminActionData,
  type IAdminActionRepository,
} from '@/repositories/admin-action.repository';
import { createLogger } from '@/lib/logger';

import { SALT_ROUNDS } from '@/services/auth/auth.service';

const log = createLogger('admin');

type AuditTarget = Pick<CreateAdminActionData, 'targetType' | 'targetId' | 'targetLabel'>;

const userTarget = (user: Pick<User, 'id' | 'email'>): AuditTarget =>
  ({ targetType: 'USER', targetId: user.id, targetLabel: user.email });
const projectTarget = (project: Pick<Project, 'id' | 'name'>): AuditTarget =>
  ({ targetType: 'PROJECT', targetId: project.id, targetLabel: project.name });

/** One row of the admin user table. Deliberately excludes `passwordHash`. */
export interface AdminUserRow {
  id: string;
  email: string;
  role: UserRole;
  projectQuota: number;
  domainQuota: number;
  mustResetPassword: boolean;
  suspendedAt: Date | null;
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

export interface BulkCreateResult {
  created: string[];
  /** Already registered. */
  skipped: string[];
  invalid: string[];
}

export class AdminService {
  constructor(
    private readonly userRepo: IUserRepository,
    private readonly projectRepo: IProjectRepository,
    private readonly docker: IDockerOps,
    private readonly deploymentRepo: IDeploymentRepository,
    private readonly adminActions: IAdminActionRepository,
  ) {}

  /**
   * Writes the audit entry for an admin action that has already succeeded.
   * A failed write is logged rather than thrown: the action happened, and
   * reporting it as failed would invite a retry of, say, a delete.
   */
  private async record(actorId: string, action: string, target: AuditTarget, meta?: Prisma.InputJsonValue): Promise<void> {
    try {
      const actor = await this.userRepo.findById(actorId);
      await this.adminActions.create({ actorId, actorEmail: actor?.email ?? 'unknown', action, ...target, meta });
    } catch (err) {
      log.error('Failed to record admin action', { action, actorId, targetId: target.targetId, error: String(err) });
    }
  }

  /** Recent admin actions, newest first. */
  async listActions(limit: number, before?: string): Promise<AdminAction[]> {
    return this.adminActions.findRecent(limit, before);
  }

  /**
   * Deleting mid-deploy would orphan the deploy's candidate container: cleanup
   * removes only `dropdeploy-<slug>`, and the cascade deletes the row the worker
   * then fails to activate, so its error path never removes the candidate.
   */
  private async assertNoDeployInFlight(projects: Pick<Project, 'id' | 'name'>[]): Promise<void> {
    for (const project of projects) {
      const inFlight = (await this.deploymentRepo.findBuildingDeployment(project.id))
        ?? (await this.deploymentRepo.findQueuedDeploymentForProject(project.id));
      if (inFlight) {
        throw new ConflictError(
          `"${project.name}" has a deploy in progress. Wait for it to finish, or cancel it if it is still queued, then try again.`,
        );
      }
    }
  }

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
          suspendedAt: true,
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

    const updated = toPublicUser(await this.writeKeepingAnActiveContributor(
      userId,
      role !== 'CONTRIBUTOR' ? 'Cannot remove the last CONTRIBUTOR' : null,
      (tx) => this.userRepo.updateRole(userId, role, tx),
    ));
    await this.record(actorId, 'USER_ROLE_CHANGED', userTarget(user), { from: user.role, to: role });
    return updated;
  }

  async deleteUser(userId: string, actorId: string): Promise<void> {
    if (userId === actorId) {
      throw new ValidationError('Cannot delete your own account');
    }
    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundError('User');

    // Refuse before the irreversible container cleanup below; the delete re-checks under the lock.
    if (user.role === 'CONTRIBUTOR') {
      const { prisma } = await import('@/lib/prisma');
      const others = await prisma.user.count({
        where: { role: 'CONTRIBUTOR', suspendedAt: null, id: { not: userId } },
      });
      if (others === 0) throw new ConflictError('Cannot delete the last CONTRIBUTOR');
    }

    // The DB cascade drops the project rows but not their containers, images or files.
    const projects = await this.projectRepo.findByUserId(userId);
    await this.assertNoDeployInFlight(projects);
    for (const project of projects) {
      try {
        await this.docker.removeProjectResources(project.slug);
      } catch (err) {
        // Other errors stay unwrapped so handleApiError logs them.
        if (!(err instanceof AppError)) throw err;
        // Earlier projects may already be cleaned up; removeProjectResources is idempotent, so a retry finishes the job.
        throw new AppError(
          err.code,
          `Could not remove the container and files of "${project.name}" (${err.message}). The user was not deleted, and retrying is safe.`,
          err.statusCode,
        );
      }
    }
    await this.writeKeepingAnActiveContributor(userId, 'Cannot delete the last CONTRIBUTOR', (tx) =>
      this.userRepo.delete(userId, tx));
    await this.record(actorId, 'USER_DELETED', userTarget(user));
  }

  /**
   * Runs `write` in one transaction that first takes a fixed advisory lock, so
   * every role change, suspension and delete is serialised: two admins demoting
   * each other at once cannot both pass the count. With a `refusal`, throws it
   * when `userId` is a CONTRIBUTOR and no other active one exists. Suspended
   * ones do not count: they cannot sign in to reinstate anyone. Relies on the
   * default READ COMMITTED, so the count sees whatever the lock waited for.
   */
  private async writeKeepingAnActiveContributor<T>(
    userId: string,
    refusal: string | null,
    write: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const { prisma } = await import('@/lib/prisma');
    return prisma.$transaction(async (tx) => {
      // Released at commit or rollback. The key only has to be unique to this lock.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(724100)`;
      if (refusal) {
        // Read the role under the lock: a promotion may have landed since the caller looked.
        const target = await tx.user.findUnique({ where: { id: userId }, select: { role: true } });
        if (target?.role === 'CONTRIBUTOR') {
          const others = await tx.user.count({
            where: { role: 'CONTRIBUTOR', suspendedAt: null, id: { not: userId } },
          });
          if (others === 0) throw new ConflictError(refusal);
        }
      }
      return write(tx);
    });
  }

  /** Suspending blocks sign-in and revokes every session; the user's sites keep running. */
  async setUserSuspended(userId: string, suspended: boolean, actorId: string): Promise<PublicUser> {
    if (suspended && userId === actorId) {
      throw new ValidationError('You cannot suspend your own account');
    }
    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundError('User');
    const updated = toPublicUser(await this.writeKeepingAnActiveContributor(
      userId,
      suspended ? 'Cannot suspend the last active CONTRIBUTOR' : null,
      (tx) => this.userRepo.setSuspended(userId, suspended, tx),
    ));
    await this.record(actorId, suspended ? 'USER_SUSPENDED' : 'USER_UNSUSPENDED', userTarget(user));
    return updated;
  }

  /** Revokes every browser session and CLI token the user holds. */
  async signOutEverywhere(userId: string, actorId: string): Promise<void> {
    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundError('User');
    await this.userRepo.revokeSessions(userId);
    await this.record(actorId, 'USER_SIGNED_OUT', userTarget(user));
  }

  async createUser(email: string, password: string, actorId: string): Promise<PublicUser> {
    const existing = await this.userRepo.findByEmail(email);
    if (existing) throw new ConflictError('Email already registered');
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await this.userRepo.create({ email, passwordHash, role: 'USER', mustResetPassword: true });
    await this.record(actorId, 'USER_CREATED', userTarget(user));
    return toPublicUser(user);
  }

  /**
   * Creates USER accounts in bulk, all with one temporary password they must
   * change on first login. Existing accounts are skipped, never changed.
   */
  async bulkCreateUsers(input: string[], password: string, actorId: string): Promise<BulkCreateResult> {
    if (password.length < 8) throw new ValidationError('Password must be at least 8 characters');
    const emails = [...new Set(input.map((e) => e.trim().toLowerCase()).filter(Boolean))];
    const isEmail = (e: string): boolean => z.string().email().safeParse(e).success;
    const valid = emails.filter(isEmail);
    const invalid = emails.filter((e) => !isEmail(e));
    const created = valid.length ? await this.userRepo.createMany(valid, await bcrypt.hash(password, SALT_ROUNDS)) : [];
    const createdSet = new Set(created);
    const result = { created, skipped: valid.filter((e) => !createdSet.has(e)), invalid };
    if (created.length > 0) {
      await this.record(
        actorId,
        'USERS_BULK_CREATED',
        { targetType: 'USER', targetId: null, targetLabel: `${created.length} users` },
        { created, skipped: result.skipped.length, invalid: invalid.length },
      );
    }
    return result;
  }

  async listAllProjects(): Promise<(Project & { user: { id: string; email: string; role: string }; deployments: { id: string; status: string; createdAt: Date }[] })[]> {
    return this.projectRepo.findAll();
  }

  async transferOwnership(projectId: string, newOwnerId: string, actorId: string): Promise<Project> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) throw new NotFoundError('Project');
    const newOwner = await this.userRepo.findById(newOwnerId);
    if (!newOwner) throw new NotFoundError('User');
    const oldOwner = await this.userRepo.findById(project.userId);
    const updated = await this.projectRepo.transferOwner(projectId, newOwnerId);
    await this.record(actorId, 'PROJECT_TRANSFERRED', projectTarget(project), {
      slug: project.slug,
      from: oldOwner?.email ?? project.userId,
      to: newOwner.email,
    });
    return updated;
  }

  async deleteProject(projectId: string, actorId: string): Promise<void> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) throw new NotFoundError('Project');
    await this.assertNoDeployInFlight([project]);
    await this.docker.removeProjectResources(project.slug);
    await this.projectRepo.delete(projectId);
    await this.record(actorId, 'PROJECT_DELETED', projectTarget(project), { slug: project.slug });
  }

  async getProjectContainerInfo(projectId: string): Promise<ContainerInfo | null> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) throw new NotFoundError('Project');
    return this.docker.containerInfo(containerNameFor(project.slug));
  }

  async stopContainer(projectId: string, actorId: string): Promise<void> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) throw new NotFoundError('Project');
    // A build or rollback going live would race this stop and could leave the
    // project marked stopped while its new container serves.
    const [building, queued] = await Promise.all([
      this.deploymentRepo.findBuildingDeployment(projectId),
      this.deploymentRepo.findQueuedDeploymentForProject(projectId),
    ]);
    if (building || queued) {
      throw new ConflictError('A deployment is in progress. Stop the project once it finishes.');
    }
    const name = containerNameFor(project.slug);
    // Static-hosted and never-deployed projects have nothing to stop; marking
    // them stopped would show STOPPED while the site keeps serving.
    const info = await this.docker.containerInfo(name);
    if (!info) throw new ValidationError('This project has no container to stop');
    // Just after a deployment goes live, the old container keeps this name until
    // it is retired (or removed, on a switch to static hosting). Stopping it
    // would mark the project stopped while the new deployment serves.
    const live = await this.deploymentRepo.findLiveDeployment(project.slug);
    if (!live?.containerPort || info.ports[0]?.hostPort !== live.containerPort) {
      throw new ConflictError('This container is not the one serving the site. Try again in a moment.');
    }
    await this.docker.stopContainer(name);
    await this.projectRepo.setStoppedAt(projectId, new Date());
    await this.record(actorId, 'PROJECT_STOPPED', projectTarget(project), { slug: project.slug });
  }

  async restartContainer(projectId: string, actorId: string): Promise<void> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) throw new NotFoundError('Project');
    await this.docker.restartContainer(containerNameFor(project.slug));
    await this.projectRepo.setStoppedAt(projectId, null);
    await this.record(actorId, 'PROJECT_RESTARTED', projectTarget(project), { slug: project.slug });
  }

  /** Project and/or custom-domain allowance. Zero means the user cannot add any. */
  async updateUserQuotas(
    userId: string,
    quotas: { projectQuota?: number; domainQuota?: number },
    actorId: string,
  ): Promise<PublicUser> {
    const { projectQuota, domainQuota } = quotas;
    if ((projectQuota ?? 0) < 0 || (domainQuota ?? 0) < 0) {
      throw new ValidationError('Quota must be a non-negative integer');
    }
    const before = await this.userRepo.findById(userId);
    if (!before) throw new NotFoundError('User');
    let user = before;
    if (projectQuota !== undefined) user = await this.userRepo.updateQuota(userId, projectQuota);
    if (domainQuota !== undefined) user = await this.userRepo.updateDomainQuota(userId, domainQuota);

    const changes: Record<string, { from: number; to: number }> = {};
    if (projectQuota !== undefined && projectQuota !== before.projectQuota) {
      changes.projectQuota = { from: before.projectQuota, to: projectQuota };
    }
    if (domainQuota !== undefined && domainQuota !== before.domainQuota) {
      changes.domainQuota = { from: before.domainQuota, to: domainQuota };
    }
    if (Object.keys(changes).length > 0) {
      await this.record(actorId, 'USER_QUOTA_CHANGED', userTarget(before), changes);
    }
    return toPublicUser(user);
  }

  async resetUserPassword(userId: string, newPassword: string, actorId: string): Promise<void> {
    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundError('User');
    if (newPassword.length < 8) throw new ValidationError('Password must be at least 8 characters');
    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    // The admin now knows this password, so the user must replace it on next
    // sign-in; setPassword also signs them out everywhere.
    await this.userRepo.setPassword(userId, passwordHash, true);
    await this.record(actorId, 'USER_PASSWORD_RESET', userTarget(user));
  }

  async forceRedeploy(projectId: string, actorId: string): Promise<void> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) throw new NotFoundError('Project');
    // Bypass ownership check by delegating to deploymentService with the project's actual owner
    await deploymentService.createDeployment(projectId, project.userId);
    await this.record(actorId, 'PROJECT_REDEPLOYED', projectTarget(project), { slug: project.slug });
  }
}

export const adminService = new AdminService(
  userRepository,
  projectRepository,
  dockerOps,
  deploymentRepository,
  adminActionRepository,
);
