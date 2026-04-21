import {
  showcaseRepository,
  type IShowcaseRepository,
  type ShowcaseWithProject,
  type UpsertShowcaseDto,
  type PagedShowcase,
  type FindPublishedOptions,
} from '@/repositories/showcase.repository';
import { projectRepository, type IProjectRepository } from '@/repositories/project.repository';
import { NotFoundError, ValidationError } from '@/lib/errors';
import type { ProjectShowcase } from '@prisma/client';

export const SHOWCASE_TAGS = ['api', 'dashboard', 'bot', 'data', 'utility', 'web', 'ml', 'cli', 'other'] as const;
export type ShowcaseTag = (typeof SHOWCASE_TAGS)[number];

export class ShowcaseService {
  constructor(
    private readonly showcaseRepo: IShowcaseRepository,
    private readonly projectRepo: IProjectRepository,
  ) {}

  async getByProjectId(projectId: string, userId: string): Promise<ProjectShowcase | null> {
    const project = await this.projectRepo.findById(projectId);
    if (!project || project.userId !== userId) throw new NotFoundError('Project');
    return this.showcaseRepo.findByProjectId(projectId);
  }

  async upsert(projectId: string, userId: string, data: UpsertShowcaseDto): Promise<ProjectShowcase> {
    const project = await this.projectRepo.findById(projectId);
    if (!project || project.userId !== userId) throw new NotFoundError('Project');

    if (!data.shortDescription?.trim()) {
      throw new ValidationError('Short description is required');
    }
    if (data.shortDescription.length > 140) {
      throw new ValidationError('Short description must be 140 characters or less');
    }
    if (!Array.isArray(data.tags) || data.tags.length === 0) {
      throw new ValidationError('At least one tag is required');
    }
    if (data.tags.length > 3) {
      throw new ValidationError('Maximum 3 tags allowed');
    }
    const invalidTags = data.tags.filter((t) => !SHOWCASE_TAGS.includes(t as ShowcaseTag));
    if (invalidTags.length > 0) {
      throw new ValidationError(`Invalid tags: ${invalidTags.join(', ')}`);
    }

    return this.showcaseRepo.upsert(projectId, data);
  }

  async getPublished(opts?: FindPublishedOptions): Promise<PagedShowcase> {
    return this.showcaseRepo.findPublished(opts);
  }

  async getPublicBySlug(slug: string): Promise<ShowcaseWithProject> {
    const showcase = await this.showcaseRepo.findBySlug(slug);
    if (!showcase) throw new NotFoundError('Showcase');
    // increment async, don't block response
    this.showcaseRepo.incrementViewCount(showcase.projectId).catch(() => {});
    return showcase;
  }
}

export const showcaseService = new ShowcaseService(showcaseRepository, projectRepository);
