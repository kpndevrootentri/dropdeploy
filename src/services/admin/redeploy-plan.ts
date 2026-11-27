import type { ProjectType, SourceType } from '@prisma/client';

export interface RedeployCandidate {
  id: string;
  name: string;
  slug: string;
  type: ProjectType;
  source: SourceType;
  githubUrl: string | null;
  userId: string;
  ownerEmail: string;
  /** Status of the most recent deployment, or null if it was never deployed. */
  lastStatus: string | null;
  /** When an admin stopped the live container, or null while it runs. */
  stoppedAt: Date | null;
}

export interface RedeployFilters {
  type?: ProjectType;
  source?: SourceType;
  /** The projects the admin saw in the preview; a confirmed run never reaches beyond them. */
  projectIds?: string[];
}

export interface RedeploySkip {
  project: RedeployCandidate;
  reason: string;
}

/** Why a project cannot be rebuilt from source, or null when it can. */
export function unbuildableReason(project: Pick<RedeployCandidate, 'source' | 'githubUrl'>): string | null {
  // The worker marks a deploy with no repository FAILED; an upload is redeployed by uploading again.
  if (project.source === 'UPLOAD') return 'Upload — nothing to pull; the owner uploads a new version';
  if (!project.githubUrl) return 'No repository URL';
  return null;
}

/**
 * Splits the projects that match the filters into those "redeploy all" will
 * rebuild and those it will leave alone, with the reason. Pure, so the rules
 * are testable without a database or a queue.
 */
export function planRedeployAll(
  projects: RedeployCandidate[],
  activeProjectIds: Set<string>,
  filters: RedeployFilters,
): { eligible: RedeployCandidate[]; skipped: RedeploySkip[] } {
  const eligible: RedeployCandidate[] = [];
  const skipped: RedeploySkip[] = [];
  for (const project of projects) {
    if (filters.type && project.type !== filters.type) continue;
    if (filters.source && project.source !== filters.source) continue;
    if (filters.projectIds && !filters.projectIds.includes(project.id)) continue;
    const reason =
      unbuildableReason(project)
      ?? (project.lastStatus === null ? 'Never deployed'
      // A deploy going live starts the container, undoing the stop.
      : project.stoppedAt ? 'Stopped by an admin; restart it first'
      // A new deploy would cancel a queued one (supersede) or wait behind a running one.
      : activeProjectIds.has(project.id) ? 'A deploy is already queued or building'
      : null);
    if (reason) skipped.push({ project, reason });
    else eligible.push(project);
  }
  return { eligible, skipped };
}
