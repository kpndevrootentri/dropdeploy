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

const MAX_LINK_LENGTH = 2048;

/**
 * Showcase links are rendered as `href`s on the public explore pages, so only
 * ordinary web (and, for contact, mail) links are accepted. React blocks
 * `javascript:` at render time; this also keeps out `data:`, `file:`, custom
 * app schemes and unbounded strings.
 */
function assertPublicLink(value: string | null | undefined, label: string, protocols: string[]): void {
  if (!value) return;
  if (value.length > MAX_LINK_LENGTH) {
    throw new ValidationError(`${label} must be ${MAX_LINK_LENGTH} characters or less`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ValidationError(`${label} must be a full URL, e.g. https://example.com`);
  }
  if (!protocols.includes(url.protocol)) {
    throw new ValidationError(`${label} must start with ${protocols.map((p) => p.replace(':', '')).join(' or ')}`);
  }
}

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
    assertPublicLink(data.liveUrl, 'Live URL', ['http:', 'https:']);
    assertPublicLink(data.repoUrl, 'Repository URL', ['http:', 'https:']);
    assertPublicLink(data.contactUrl, 'Contact URL', ['http:', 'https:', 'mailto:']);

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
