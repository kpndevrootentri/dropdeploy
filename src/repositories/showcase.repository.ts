import type { ProjectShowcase } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export type ShowcaseWithProject = ProjectShowcase & {
  project: {
    id: string;
    name: string;
    slug: string;
    type: string;
    githubUrl: string | null;
    user: { handle: string };
  };
};

export interface UpsertShowcaseDto {
  shortDescription: string;
  tags: string[];
  liveUrl?: string | null;
  repoUrl?: string | null;
  contactUrl?: string | null;
  isPublished: boolean;
}

export interface FindPublishedOptions {
  skip?: number;
  take?: number;
  tag?: string;
  q?: string;
}

export interface PagedShowcase {
  items: ShowcaseWithProject[];
  total: number;
}

/** One row of the admin showcase table. */
export type AdminShowcaseRow = Pick<
  ProjectShowcase,
  'projectId' | 'shortDescription' | 'isPublished' | 'publishedAt' | 'featured' | 'viewCount' | 'updatedAt'
> & { project: { name: string; slug: string; user: { email: string } } };

export interface IShowcaseRepository {
  findByProjectId(projectId: string): Promise<ProjectShowcase | null>;
  /** Every entry, published or not, for the admin panel. */
  listAll(): Promise<AdminShowcaseRow[]>;
  /** Admin moderation: publish state and/or featured flag only. */
  setFlags(projectId: string, flags: { isPublished?: boolean; featured?: boolean }): Promise<ProjectShowcase>;
  findBySlug(slug: string): Promise<ShowcaseWithProject | null>;
  findPublished(opts?: FindPublishedOptions): Promise<PagedShowcase>;
  upsert(projectId: string, data: UpsertShowcaseDto): Promise<ProjectShowcase>;
  incrementViewCount(projectId: string): Promise<void>;
}

export class ShowcaseRepository implements IShowcaseRepository {
  async findByProjectId(projectId: string): Promise<ProjectShowcase | null> {
    return prisma.projectShowcase.findUnique({ where: { projectId } });
  }

  async listAll(): Promise<AdminShowcaseRow[]> {
    return prisma.projectShowcase.findMany({
      orderBy: [{ featured: 'desc' }, { viewCount: 'desc' }],
      select: {
        projectId: true,
        shortDescription: true,
        isPublished: true,
        publishedAt: true,
        featured: true,
        viewCount: true,
        updatedAt: true,
        project: { select: { name: true, slug: true, user: { select: { email: true } } } },
      },
    });
  }

  /** Leaves `publishedAt` alone, so an admin unpublish can be undone with the original date. */
  async setFlags(projectId: string, flags: { isPublished?: boolean; featured?: boolean }): Promise<ProjectShowcase> {
    return prisma.projectShowcase.update({ where: { projectId }, data: flags });
  }

  async findBySlug(slug: string): Promise<ShowcaseWithProject | null> {
    const raw = await prisma.projectShowcase.findFirst({
      where: { project: { slug }, isPublished: true },
      include: {
        project: {
          select: { id: true, name: true, slug: true, type: true, githubUrl: true, user: { select: { email: true } } },
        },
      },
    });
    if (!raw) return null;
    return { ...raw, project: { ...raw.project, user: { handle: raw.project.user.email.split('@')[0] } } };
  }

  async findPublished({ skip = 0, take = 12, tag, q }: FindPublishedOptions = {}): Promise<PagedShowcase> {
    const where = {
      isPublished: true,
      ...(tag ? { tags: { has: tag } } : {}),
      ...(q ? {
        OR: [
          { shortDescription: { contains: q, mode: 'insensitive' as const } },
          { project: { name: { contains: q, mode: 'insensitive' as const } } },
        ],
      } : {}),
    };

    const include = {
      project: {
        select: { id: true, name: true, slug: true, type: true, githubUrl: true, user: { select: { email: true } } },
      },
    };

    const [rawItems, total] = await Promise.all([
      prisma.projectShowcase.findMany({ where, include, orderBy: [{ featured: 'desc' }, { publishedAt: 'desc' }], skip, take }),
      prisma.projectShowcase.count({ where }),
    ]);

    const items: ShowcaseWithProject[] = rawItems.map((raw) => ({
      ...raw,
      project: { ...raw.project, user: { handle: raw.project.user.email.split('@')[0] } },
    }));
    return { items, total };
  }

  async upsert(projectId: string, data: UpsertShowcaseDto): Promise<ProjectShowcase> {
    const publishedAt = data.isPublished
      ? (await prisma.projectShowcase.findUnique({ where: { projectId } }))?.publishedAt ?? new Date()
      : null;

    return prisma.projectShowcase.upsert({
      where: { projectId },
      create: {
        projectId,
        shortDescription: data.shortDescription,
        tags: data.tags,
        liveUrl: data.liveUrl ?? null,
        repoUrl: data.repoUrl ?? null,
        contactUrl: data.contactUrl ?? null,
        isPublished: data.isPublished,
        publishedAt: data.isPublished ? new Date() : null,
      },
      update: {
        shortDescription: data.shortDescription,
        tags: data.tags,
        liveUrl: data.liveUrl ?? null,
        repoUrl: data.repoUrl ?? null,
        contactUrl: data.contactUrl ?? null,
        isPublished: data.isPublished,
        publishedAt,
      },
    });
  }

  async incrementViewCount(projectId: string): Promise<void> {
    await prisma.projectShowcase.update({
      where: { projectId },
      data: { viewCount: { increment: 1 } },
    });
  }
}

export const showcaseRepository = new ShowcaseRepository();
