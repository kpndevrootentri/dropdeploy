import { randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import type { User, UserRole, CohortRole, Project, Prisma, AdminAction } from '@prisma/client';
import type { IUserRepository, NewUserQuotas } from '@/repositories/user.repository';
import { userRepository } from '@/repositories/user.repository';
import type { IProjectRepository, ProjectWithOwner } from '@/repositories/project.repository';
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
import {
  inviteService,
  newInviteToken,
  unusablePasswordHash,
  INVITE_TTL_MS,
  RESET_TTL_MS,
  type InviteService,
  type PasswordLinkKind,
} from '@/services/invite';
import { getConfig } from '@/lib/config';
import { planRedeployAll, type RedeployCandidate, type RedeployFilters } from './redeploy-plan';

import { SALT_ROUNDS } from '@/services/auth/auth.service';
import { newUserQuotas, platformSettingsService, type PlatformSettingsService } from '@/services/platform-settings/platform-settings.service';
import { splitEmails } from '@/validators/auth.validator';

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
  name: string | null;
  role: UserRole;
  projectQuota: number;
  domainQuota: number;
  mustResetPassword: boolean;
  suspendedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** Batches they are in now (membership not ended), newest joined first. */
  cohortMemberships: { role: CohortRole; cohort: { name: string } }[];
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

/** A password for an admin to hand over once; the user must replace it at next sign-in. */
export function generatePassword(): string {
  return randomBytes(12).toString('base64url');
}

export class AdminService {
  constructor(
    private readonly userRepo: IUserRepository,
    private readonly projectRepo: IProjectRepository,
    private readonly docker: IDockerOps,
    private readonly deploymentRepo: IDeploymentRepository,
    private readonly adminActions: IAdminActionRepository,
    private readonly settings: Pick<PlatformSettingsService, 'get'> = platformSettingsService,
    private readonly invites: Pick<InviteService, 'issue'> = inviteService,
  ) {}

  /** Quotas for accounts created now, from the admin-editable platform settings. */
  private async newUserQuotas(): Promise<NewUserQuotas> {
    return newUserQuotas(await this.settings.get());
  }

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
  async listAllUsers({ cohortId }: { cohortId?: string } = {}): Promise<AdminUserRow[]> {
    const { prisma } = await import('@/lib/prisma');
    const current = { endedAt: null };

    const [users, domains] = await Promise.all([
      prisma.user.findMany({
        where: cohortId ? { cohortMemberships: { some: { cohortId, ...current } } } : undefined,
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          projectQuota: true,
          domainQuota: true,
          mustResetPassword: true,
          suspendedAt: true,
          createdAt: true,
          updatedAt: true,
          cohortMemberships: { where: current, orderBy: { joinedAt: 'desc' }, select: { role: true, cohort: { select: { name: true } } } },
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

  /** Revokes every browser session, CLI login and API token the user holds. */
  async signOutEverywhere(userId: string, actorId: string): Promise<void> {
    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundError('User');
    await this.userRepo.revokeSessions(userId);
    await this.record(actorId, 'USER_SIGNED_OUT', userTarget(user));
  }

  /**
   * Creates a USER who cannot sign in until they open their invite link and
   * choose a password. The token is returned once and never stored in clear.
   */
  async inviteUser(email: string, actorId: string): Promise<{ user: PublicUser; inviteToken: string }> {
    const existing = await this.userRepo.findByEmail(email);
    if (existing) throw new ConflictError('Email already registered');
    const { token, tokenHash, expiresAt } = newInviteToken();
    const user = await this.userRepo.create({
      email,
      passwordHash: await unusablePasswordHash(),
      role: 'USER',
      mustResetPassword: true,
      ...(await this.newUserQuotas()),
      invite: { tokenHash, expiresAt },
    });
    await this.record(actorId, 'USER_CREATED', userTarget(user), { invite: true });
    return { user: toPublicUser(user), inviteToken: token };
  }

  /**
   * Invites many users at once, each with their own one-time link. Existing
   * accounts are skipped, never changed.
   */
  async bulkInviteUsers(input: string[], actorId: string): Promise<BulkInviteResult> {
    const { valid, invalid } = splitEmails(input);
    // Tokens for emails that turn out to be registered are simply never stored.
    const tokens = new Map(valid.map((email) => [email, newInviteToken()]));
    const users = valid.length
      ? await this.userRepo.createMany(
          [...tokens].map(([email, t]) => ({ email, tokenHash: t.tokenHash, expiresAt: t.expiresAt })),
          await unusablePasswordHash(),
          await this.newUserQuotas(),
        )
      : [];
    const created = users.map((u) => ({ email: u.email, inviteToken: tokens.get(u.email)!.token }));
    const createdSet = new Set(users.map((u) => u.email));
    const result = { created, skipped: valid.filter((e) => !createdSet.has(e)), invalid };
    if (created.length > 0) {
      // Emails only: the invite tokens must never reach the audit log.
      await this.record(
        actorId,
        'USERS_BULK_CREATED',
        { targetType: 'USER', targetId: null, targetLabel: `${created.length} users` },
        { created: created.map((c) => c.email), skipped: result.skipped.length, invalid: invalid.length },
      );
    }
    return result;
  }

  /**
   * A fresh password link for a user: an invite (7 days), e.g. when the first
   * one expired or went to the wrong person, or a reset link (1 hour). Earlier
   * unused links stop working. Audited, because the admin sees a link that sets
   * this user's password.
   */
  async issuePasswordLink(
    userId: string,
    kind: PasswordLinkKind,
    actorId: string,
  ): Promise<{ token: string; email: string }> {
    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundError('User');
    // mustResetPassword alone cannot pick the kind: an admin-set password sets it too.
    if (kind === 'invite' && !user.mustResetPassword) {
      throw new ValidationError('They already chose a password; send a reset link instead');
    }
    const token = await this.invites.issue(userId, kind === 'invite' ? INVITE_TTL_MS : RESET_TTL_MS);
    await this.record(actorId, 'USER_PASSWORD_LINK_ISSUED', userTarget(user), { kind });
    return { token, email: user.email };
  }

  async listAllProjects(opts?: { cohortId?: string }): Promise<ProjectWithOwner[]> {
    return this.projectRepo.findAll(opts);
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

  /**
   * The live container's recent output. It can hold the tenant's secrets, so
   * every read is audited and the text itself is never logged.
   */
  async getProjectContainerLogs(projectId: string, tail: number, actorId: string): Promise<string | null> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) throw new NotFoundError('Project');
    const logs = await this.docker.containerLogs(containerNameFor(project.slug), tail);
    await this.record(actorId, 'PROJECT_CONTAINER_LOGS_VIEWED', projectTarget(project), { slug: project.slug, tail });
    return logs;
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

  /**
   * Sets a password the admin hands over. With no password given, one is
   * generated and returned so the admin can copy it once.
   */
  async resetUserPassword(
    userId: string,
    newPassword: string | undefined,
    actorId: string,
  ): Promise<{ generatedPassword?: string }> {
    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundError('User');
    const password = newPassword ?? generatePassword();
    if (password.length < 8) throw new ValidationError('Password must be at least 8 characters');
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    // The admin now knows this password, so the user must replace it on next
    // sign-in; setPassword also signs them out everywhere.
    await this.userRepo.setPassword(userId, passwordHash, true);
    await this.record(actorId, 'USER_PASSWORD_RESET', userTarget(user));
    return newPassword === undefined ? { generatedPassword: password } : {};
  }

  async forceRedeploy(projectId: string, actorId: string): Promise<void> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) throw new NotFoundError('Project');
    // Bypass ownership check by delegating to deploymentService with the project's actual owner
    await deploymentService.createDeployment(projectId, project.userId);
    await this.record(actorId, 'PROJECT_REDEPLOYED', projectTarget(project), { slug: project.slug });
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
      stoppedAt: p.stoppedAt,
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

export const adminService = new AdminService(
  userRepository,
  projectRepository,
  dockerOps,
  deploymentRepository,
  adminActionRepository,
  platformSettingsService,
  inviteService,
);
