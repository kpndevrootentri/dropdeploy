import type { ProjectShowcase } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export type ShowcaseWithProject = ProjectShowcase & {
  project: {
    id: string;
    name: string;
    slug: string;
    type: string;
    githubUrl: string | null;
    user: { email: string };
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

export interface IShowcaseRepository {
  findByProjectId(projectId: string): Promise<ProjectShowcase | null>;
  findBySlug(slug: string): Promise<ShowcaseWithProject | null>;
  findPublished(opts?: FindPublishedOptions): Promise<PagedShowcase>;
  upsert(projectId: string, data: UpsertShowcaseDto): Promise<ProjectShowcase>;
  incrementViewCount(projectId: string): Promise<void>;
}

export class ShowcaseRepository implements IShowcaseRepository {
  async findByProjectId(projectId: string): Promise<ProjectShowcase | null> {
    return prisma.projectShowcase.findUnique({ where: { projectId } });
  }

  async findBySlug(slug: string): Promise<ShowcaseWithProject | null> {
    return prisma.projectShowcase.findFirst({
      where: { project: { slug }, isPublished: true },
      include: {
        project: {
          select: { id: true, name: true, slug: true, type: true, githubUrl: true, user: { select: { email: true } } },
        },
      },
    });
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

    const [items, total] = await Promise.all([
      prisma.projectShowcase.findMany({ where, include, orderBy: { publishedAt: 'desc' }, skip, take }),
      prisma.projectShowcase.count({ where }),
    ]);

    return { items: items as ShowcaseWithProject[], total };
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
