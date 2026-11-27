import type { Project, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { isReservedSlug } from '@/lib/reserved-slugs';
import type { CreateProjectDto, UpdateProjectDto } from '@/types/project.types';

/** A project for the admin pages: its owner, its batch's name and its latest deployment. */
export type ProjectWithOwner = Project & {
  user: { id: string; email: string; role: string };
  cohort: { name: string } | null;
  deployments: { id: string; status: string; createdAt: Date; containerPort: number | null; buildStep: string | null; failureReason: string | null }[];
};

export interface IProjectRepository {
  findById(id: string): Promise<Project | null>;
  findByIdWithDeployments(id: string): Promise<Project | null>;
  findByUserId(userId: string): Promise<Project[]>;
  findBySlug(slug: string): Promise<Project | null>;
  /** Which of the given slugs belong to a project, in one query. */
  findExistingSlugs(slugs: string[]): Promise<string[]>;
  /** Newest first; only the projects in `cohortId` when it is given. */
  findAll(opts?: { cohortId?: string }): Promise<ProjectWithOwner[]>;
  /**
   * Creates the project unless its owner already has `quota` projects; returns
   * null when the quota is full. The count and the insert are atomic per user.
   */
  create(userId: string, data: CreateProjectDto & { cohortId?: string | null }, quota: number): Promise<Project | null>;
  update(id: string, data: UpdateProjectDto): Promise<Project>;
  delete(id: string): Promise<void>;
  transferOwner(id: string, newUserId: string): Promise<Project>;
  /** Records that the live container was stopped (a date) or started again (null). */
  setStoppedAt(id: string, stoppedAt: Date | null): Promise<void>;
  /** Admin-only switch: build from the repository's own Dockerfile. */
  setAllowRepoDockerfile(id: string, allowed: boolean): Promise<void>;
  /** Enable auto-deploy and persist the GitHub hook id + encrypted webhook secret. */
  setWebhookConfig(id: string, data: { githubHookId: string; webhookSecretEnc: string; webhookSecretIv: string; webhookSecretTag: string }): Promise<Project>;
  /** Disable auto-deploy and clear all webhook fields. */
  clearWebhookConfig(id: string): Promise<Project>;
  /** All auto-deploy-enabled GitHub projects on a given branch whose owner is not suspended (webhook fan-out). */
  findAutoDeployByBranch(branch: string): Promise<(Project & { user: { role: string } })[]>;
}

export class ProjectRepository implements IProjectRepository {
  async findById(id: string): Promise<Project | null> {
    return prisma.project.findUnique({ where: { id } });
  }

  async findByIdWithDeployments(id: string): Promise<Project | null> {
    return prisma.project.findUnique({
      where: { id },
      include: {
        deployments: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
    });
  }

  async findByUserId(userId: string): Promise<Project[]> {
    return prisma.project.findMany({
      where: { userId },
      include: {
        deployments: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
  }

  async findBySlug(slug: string): Promise<Project | null> {
    return prisma.project.findUnique({ where: { slug } });
  }

  async findExistingSlugs(slugs: string[]): Promise<string[]> {
    const rows = await prisma.project.findMany({ where: { slug: { in: slugs } }, select: { slug: true } });
    return rows.map((r) => r.slug);
  }

  async findAll({ cohortId }: { cohortId?: string } = {}): Promise<ProjectWithOwner[]> {
    return prisma.project.findMany({
      where: cohortId ? { cohortId } : undefined,
      include: {
        user: { select: { id: true, email: true, role: true } },
        cohort: { select: { name: true } },
        deployments: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, status: true, createdAt: true, containerPort: true, buildStep: true, failureReason: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(userId: string, data: CreateProjectDto & { cohortId?: string | null }, quota: number): Promise<Project | null> {
    const slug = await this.generateUniqueSlug(data.name);
    return prisma.$transaction(async (tx) => {
      // Held until the transaction ends, so two parallel creates by one user cannot both pass the count.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
      if ((await tx.project.count({ where: { userId } })) >= quota) return null;
      return tx.project.create({
        data: {
          userId,
          name: data.name,
          description: data.description,
          slug,
          source: data.source,
          githubUrl: data.githubUrl,
          type: data.type ?? 'STATIC',
          branch: data.branch ?? 'main',
          useStaticHosting: data.useStaticHosting ?? false,
          isPrivate: data.isPrivate ?? false,
          cohortId: data.cohortId ?? null,
        },
      });
    });
  }

  async update(id: string, data: UpdateProjectDto): Promise<Project> {
    return prisma.project.update({
      where: { id },
      data: data as Prisma.ProjectUpdateInput,
    });
  }

  async delete(id: string): Promise<void> {
    await prisma.project.delete({ where: { id } });
  }

  async transferOwner(id: string, newUserId: string): Promise<Project> {
    return prisma.project.update({ where: { id }, data: { userId: newUserId } });
  }

  async setStoppedAt(id: string, stoppedAt: Date | null): Promise<void> {
    await prisma.project.update({ where: { id }, data: { stoppedAt } });
  }

  async setAllowRepoDockerfile(id: string, allowed: boolean): Promise<void> {
    await prisma.project.update({ where: { id }, data: { allowRepoDockerfile: allowed } });
  }

  async setWebhookConfig(
    id: string,
    data: { githubHookId: string; webhookSecretEnc: string; webhookSecretIv: string; webhookSecretTag: string },
  ): Promise<Project> {
    return prisma.project.update({
      where: { id },
      data: { autoDeploy: true, ...data },
    });
  }

  async clearWebhookConfig(id: string): Promise<Project> {
    return prisma.project.update({
      where: { id },
      data: {
        autoDeploy: false,
        githubHookId: null,
        webhookSecretEnc: null,
        webhookSecretIv: null,
        webhookSecretTag: null,
      },
    });
  }

  async findAutoDeployByBranch(branch: string): Promise<(Project & { user: { role: string } })[]> {
    return prisma.project.findMany({
      // A suspended owner must not be able to rebuild their site with a git push.
      where: { autoDeploy: true, source: 'GITHUB', branch, user: { suspendedAt: null } },
      include: { user: { select: { role: true } } }, // the owner's role, for the per-owner push limit
    });
  }

  private async generateUniqueSlug(base: string): Promise<string> {
    const slugBase = base
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'project';
    let slug = slugBase;
    let counter = 0;
    // A reserved name gets a numeric suffix like any taken one: `admin` → `admin-1`.
    while (isReservedSlug(slug) || (await this.findBySlug(slug))) {
      counter += 1;
      slug = `${slugBase}-${counter}`;
    }
    return slug;
  }
}

export const projectRepository = new ProjectRepository();
