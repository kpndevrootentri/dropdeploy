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
}

export interface RedeployFilters {
  type?: ProjectType;
  source?: SourceType;
}

export interface RedeploySkip {
  project: RedeployCandidate;
  reason: string;
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
    // ponytail: a site an admin stopped is rebuilt and started again; skip `stoppedAt` projects once #21 adds that column.
    const reason =
      // The worker marks a deploy with no repository FAILED; an upload is redeployed by uploading again.
      project.source === 'UPLOAD' ? 'Upload — nothing to pull; the owner uploads a new version'
      : !project.githubUrl ? 'No repository URL'
      : project.lastStatus === null ? 'Never deployed'
      // A new deploy would cancel a queued one (supersede) or wait behind a running one.
      : activeProjectIds.has(project.id) ? 'A deploy is already queued or building'
      : null;
    if (reason) skipped.push({ project, reason });
    else eligible.push(project);
  }
  return { eligible, skipped };
}
