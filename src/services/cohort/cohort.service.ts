/**
 * Batches (cohorts): students join a batch with a link; admins add mentors.
 * Being a student or a mentor is a membership, not a UserRole, so one person
 * can mentor one batch and study in another.
 *
 * Where core reads this module (everything to touch if batches are ever removed):
 *   - prisma/schema.prisma: Cohort, CohortMember, User.name, Project.cohortId, PlatformSetting.cohortsEnabled
 *   - ProjectService.create: stamps cohortForNewProject() on new projects
 *   - POST /api/projects/[id]/cohort: a student adds an older project to their batch (addProject)
 *   - ProjectAccessService.canView: the mentor rule for private sites (canMentorView)
 *   - the tenant proxy route: selects project.cohortId for that check
 *   - POST /api/auth/register: a join code opens sign-up even when it is closed
 *   - GET /api/auth/session: `inCohort`, which shows the Batches menu item
 *   - admin settings (the switch) and the admin layout (the Batches tab)
 *
 * The switch (PlatformSetting.cohortsEnabled) turns off joining, stamping, adding
 * projects and mentor access. Admins can still see and edit batches, and remove
 * projects from them, while it is off.
 */
import { randomBytes } from 'crypto';
import type { Cohort, CohortMember, Prisma } from '@prisma/client';
import { cohortRepository, type ICohortRepository, type CohortProjectRow, type CohortMemberRow, type CohortWithCounts, type MembershipWithCohort } from '@/repositories/cohort.repository';
import { userRepository, type IUserRepository } from '@/repositories/user.repository';
import { projectRepository, type IProjectRepository } from '@/repositories/project.repository';
import { deploymentRepository, type IDeploymentRepository, type DeploymentSummary } from '@/repositories/deployment.repository';
import { adminActionRepository, type IAdminActionRepository } from '@/repositories/admin-action.repository';
import { platformSettingsService, type PlatformSettingsService } from '@/services/platform-settings/platform-settings.service';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { slugify } from '@/lib/utils';
import { createLogger } from '@/lib/logger';
import type { CreateCohortDto, UpdateCohortDto } from '@/validators/cohort.validator';

const log = createLogger('cohort');

/** One answer for every unusable code (unknown, closed, archived, ended), so the link reveals nothing. */
export const INVALID_JOIN_MESSAGE = 'This join link is invalid or no longer open';

/** 18 random bytes: 24 base64url characters, far beyond guessing. */
export function newJoinCode(): string {
  return randomBytes(18).toString('base64url');
}

export function joinPath(code: string): string {
  return `/join/${code}`;
}

/** Who is asking: enough to tell an admin from a mentor. */
export interface CohortViewer {
  userId: string;
  role: string;
}

export interface CohortDetail {
  cohort: Cohort;
  members: CohortMemberRow[];
  projects: CohortProjectRow[];
}

export interface BuildLogView {
  id: string;
  status: string;
  buildLog: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export class CohortService {
  constructor(
    private readonly repo: ICohortRepository,
    private readonly users: Pick<IUserRepository, 'findById' | 'findByEmail'>,
    private readonly projects: Pick<IProjectRepository, 'findById'>,
    private readonly deployments: Pick<IDeploymentRepository, 'findById' | 'findByProjectId'>,
    private readonly adminActions: Pick<IAdminActionRepository, 'create'>,
    private readonly settings: Pick<PlatformSettingsService, 'get'> = platformSettingsService,
  ) {}

  async isEnabled(): Promise<boolean> {
    return (await this.settings.get()).cohortsEnabled;
  }

  // ── Admin ────────────────────────────────────────────────────────────────

  async list(): Promise<CohortWithCounts[]> {
    return this.repo.findAll();
  }

  async get(id: string): Promise<CohortDetail> {
    const cohort = await this.repo.findById(id);
    if (!cohort) throw new NotFoundError('Batch');
    const [members, projects] = await Promise.all([this.repo.listMembers(id), this.repo.listProjects(id)]);
    return { cohort, members, projects };
  }

  async create(dto: CreateCohortDto, actorId: string): Promise<Cohort> {
    const cohort = await this.repo.create({
      name: dto.name,
      program: dto.program,
      startsAt: dto.startsAt,
      endsAt: dto.endsAt,
      slug: await this.uniqueSlug(dto.name),
      joinCode: newJoinCode(),
    });
    await this.record(actorId, 'COHORT_CREATED', cohort, { program: cohort.program });
    return cohort;
  }

  async update(id: string, dto: UpdateCohortDto, actorId: string): Promise<Cohort> {
    const before = await this.repo.findById(id);
    if (!before) throw new NotFoundError('Batch');
    const startsAt = dto.startsAt ?? before.startsAt;
    const endsAt = dto.endsAt ?? before.endsAt;
    if (endsAt <= startsAt) throw new ValidationError('The end date must be after the start date');

    const data: Prisma.CohortUpdateInput = {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.program !== undefined ? { program: dto.program } : {}),
      ...(dto.startsAt !== undefined ? { startsAt } : {}),
      ...(dto.endsAt !== undefined ? { endsAt } : {}),
      ...(dto.joinOpen !== undefined ? { joinOpen: dto.joinOpen } : {}),
      // Archiving keeps the first archive date; un-archiving clears it.
      ...(dto.archived !== undefined ? { archivedAt: dto.archived ? (before.archivedAt ?? new Date()) : null } : {}),
    };
    const cohort = await this.repo.update(id, data);
    await this.record(actorId, 'COHORT_UPDATED', cohort, { changed: Object.keys(data) });
    return cohort;
  }

  /** A new join code; every link handed out before stops working. */
  async rotateJoinCode(id: string, actorId: string): Promise<Cohort> {
    if (!(await this.repo.findById(id))) throw new NotFoundError('Batch');
    const cohort = await this.repo.update(id, { joinCode: newJoinCode() });
    await this.record(actorId, 'COHORT_JOIN_CODE_ROTATED', cohort);
    return cohort;
  }

  /** Mentors are added by email; they need an active account with a password they chose themselves. */
  async addMentor(id: string, email: string, actorId: string): Promise<CohortMember> {
    const cohort = await this.repo.findById(id);
    if (!cohort) throw new NotFoundError('Batch');
    const user = await this.users.findByEmail(email.toLowerCase());
    if (!user) throw new NotFoundError('User');
    // Invited accounts and accounts after an admin password reset carry a password nobody chose.
    if (user.mustResetPassword) throw new ConflictError(`${user.email} has not set their own password yet`);
    if (user.suspendedAt) throw new ConflictError(`${user.email} is suspended`);
    const existing = await this.repo.findMember(id, user.id);
    // Turning a current student into a mentor would let them read classmates' build logs.
    if (existing && !existing.endedAt && existing.role === 'STUDENT') {
      throw new ConflictError(`${user.email} is a student in this batch. End that membership first.`);
    }
    const member = await this.repo.upsertMember(id, user.id, 'MENTOR');
    await this.record(actorId, 'COHORT_MENTOR_ADDED', cohort, { userId: user.id, email: user.email });
    return member;
  }

  /** Ends a membership. The row stays, so reports keep the history; projects keep their batch. */
  async endMembership(id: string, userId: string, actorId: string): Promise<void> {
    const cohort = await this.repo.findById(id);
    if (!cohort) throw new NotFoundError('Batch');
    const member = await this.repo.findMember(id, userId);
    if (!member || member.endedAt) throw new NotFoundError('Membership');
    await this.repo.endMember(id, userId, new Date());
    await this.record(actorId, 'COHORT_MEMBERSHIP_ENDED', cohort, { userId, role: member.role });
  }

  /** Admin: takes a project out of the batch. Mentors lose access on their next request. */
  async removeProject(cohortId: string, projectId: string, actorId: string): Promise<void> {
    const cohort = await this.repo.findById(cohortId);
    if (!cohort) throw new NotFoundError('Batch');
    // Looked up only for the audit row's name; the conditional update refuses a project from another batch.
    const project = await this.projects.findById(projectId);
    if (!project || !(await this.repo.removeProject(cohortId, projectId))) throw new NotFoundError('Project');
    await this.record(actorId, 'COHORT_PROJECT_REMOVED', cohort, { projectId, project: project.name });
  }

  // ── Joining ──────────────────────────────────────────────────────────────

  /** What the join page shows before someone signs up or joins. */
  async preview(code: string): Promise<Pick<Cohort, 'name' | 'program' | 'startsAt' | 'endsAt'>> {
    const { name, program, startsAt, endsAt } = await this.joinable(code);
    return { name, program, startsAt, endsAt };
  }

  /** Throws unless the code can be used right now. Sign-up calls this before creating the account. */
  async assertJoinable(code: string): Promise<void> {
    await this.joinable(code);
  }

  /** Adds the user as a student. Joining twice is harmless. */
  async join(code: string, userId: string): Promise<Cohort> {
    const cohort = await this.joinable(code);
    const member = await this.repo.findMember(cohort.id, userId);
    if (member && !member.endedAt) {
      if (member.role === 'MENTOR') throw new ConflictError('You are a mentor in this batch');
      return cohort;
    }
    await this.repo.upsertMember(cohort.id, userId, 'STUDENT');
    log.info('Joined batch', { cohortId: cohort.id, userId });
    return cohort;
  }

  private async joinable(code: string): Promise<Cohort> {
    const cohort = (await this.isEnabled()) ? await this.repo.findByJoinCode(code) : null;
    if (!cohort || !cohort.joinOpen || cohort.archivedAt || cohort.endsAt <= new Date()) {
      throw new ValidationError(INVALID_JOIN_MESSAGE);
    }
    return cohort;
  }

  // ── Used by core ─────────────────────────────────────────────────────────

  /** The batch a project made now belongs to, or null (no batch, or batches are off). */
  async cohortForNewProject(userId: string): Promise<string | null> {
    return (await this.studentCohort(userId))?.id ?? null;
  }

  /** The mentor rule for private sites: an active mentor of the project's batch may view it. */
  async canMentorView(cohortId: string, userId: string): Promise<boolean> {
    return (await this.isEnabled()) && this.repo.isActiveMentor(cohortId, userId);
  }

  // ── Members ──────────────────────────────────────────────────────────────

  async myMemberships(userId: string): Promise<MembershipWithCohort[]> {
    return (await this.isEnabled()) ? this.repo.listActiveMemberships(userId) : [];
  }

  /**
   * The batch a student's projects go in, new or added later: their newest-joined active student
   * membership. Null if they have none or batches are off. The one place this rule lives.
   */
  private async studentCohort(userId: string): Promise<Cohort | null> {
    return (await this.myMemberships(userId)).find((m) => m.role === 'STUDENT')?.cohort ?? null;
  }

  /**
   * A student puts an older project of theirs in their batch: the batch a new project would get.
   * `cohortId` is the batch they confirmed; a mismatch means it changed after the page loaded.
   * Only an admin can take it out.
   */
  async addProject(projectId: string, userId: string, cohortId: string): Promise<Cohort> {
    const project = await this.projects.findById(projectId);
    if (!project || project.userId !== userId) throw new NotFoundError('Project');
    const cohort = await this.studentCohort(userId);
    if (!cohort) throw new ValidationError('You are not a student in an active batch');
    if (cohort.id !== cohortId) throw new ConflictError('Your batch changed. Reload the page and try again.');
    if (!(await this.repo.addProject(projectId, userId, cohort.id))) throw new ConflictError('This project is already in a batch');
    await this.record(userId, 'COHORT_PROJECT_ADDED', cohort, { projectId, project: project.name });
    return cohort;
  }

  /** Read-only views for mentors (and admins). Nothing here exposes env vars or the terminal. */
  async listProjects(cohortId: string, viewer: CohortViewer): Promise<CohortProjectRow[]> {
    await this.assertCanOversee(cohortId, viewer);
    return this.repo.listProjects(cohortId);
  }

  async listDeployments(cohortId: string, projectId: string, viewer: CohortViewer): Promise<DeploymentSummary[]> {
    await this.assertCanOversee(cohortId, viewer);
    await this.assertProjectInCohort(cohortId, projectId);
    return this.deployments.findByProjectId(projectId, 10);
  }

  async getBuildLog(cohortId: string, projectId: string, deploymentId: string, viewer: CohortViewer): Promise<BuildLogView> {
    await this.assertCanOversee(cohortId, viewer);
    await this.assertProjectInCohort(cohortId, projectId);
    const deployment = await this.deployments.findById(deploymentId);
    if (!deployment || deployment.projectId !== projectId) throw new NotFoundError('Deployment');
    const { id, status, buildLog, createdAt, completedAt } = deployment;
    return { id, status, buildLog, createdAt, completedAt };
  }

  /** Admins always; mentors while their membership is active and batches are on. Others see a 404. */
  private async assertCanOversee(cohortId: string, viewer: CohortViewer): Promise<void> {
    if (viewer.role === 'CONTRIBUTOR') {
      if (!(await this.repo.findById(cohortId))) throw new NotFoundError('Batch');
      return;
    }
    if (!(await this.canMentorView(cohortId, viewer.userId))) throw new NotFoundError('Batch');
  }

  private async assertProjectInCohort(cohortId: string, projectId: string): Promise<void> {
    const project = await this.projects.findById(projectId);
    if (!project || project.cohortId !== cohortId) throw new NotFoundError('Project');
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private async uniqueSlug(name: string): Promise<string> {
    const base = slugify(name) || 'batch';
    let slug = base;
    for (let attempt = 0; await this.repo.slugExists(slug); attempt++) {
      if (attempt >= 5) throw new ConflictError('Could not find a free URL name for this batch; try another name');
      slug = `${base}-${randomBytes(3).toString('hex')}`;
    }
    return slug;
  }

  private async record(actorId: string, action: string, cohort: Cohort, meta?: Prisma.InputJsonValue): Promise<void> {
    try {
      const actor = await this.users.findById(actorId);
      await this.adminActions.create({
        actorId,
        actorEmail: actor?.email ?? 'unknown',
        action,
        targetType: 'COHORT',
        targetId: cohort.id,
        targetLabel: cohort.name,
        meta,
      });
    } catch (err) {
      log.error('Failed to record admin action', { action, actorId, cohortId: cohort.id, error: String(err) });
    }
  }
}

export const cohortService = new CohortService(
  cohortRepository,
  userRepository,
  projectRepository,
  deploymentRepository,
  adminActionRepository,
);
