import type { DomainStatus, EnvEnvironment } from '@prisma/client';
import { projectRepository, type IProjectRepository } from '@/repositories/project.repository';
import { envVarRepository, type IEnvironmentVariableRepository } from '@/repositories/env-var.repository';
import {
  projectAccessRepository,
  type IProjectAccessRepository,
  type ProjectAccessEntry,
} from '@/repositories/project-access.repository';
import { domainRepository, type IDomainRepository } from '@/repositories/domain.repository';
import { projectAccessService, type ProjectAccessService } from '@/services/project-access/project-access.service';
import { proxyHitRepository, type IProxyHitRepository } from '@/repositories/proxy-hit.repository';
import { auditLogRepository, type IAuditLogRepository } from '@/repositories/audit-log.repository';
import { platformSettingsService, type PlatformSettingsService } from '@/services/platform-settings/platform-settings.service';
import { dockerOps, containerNameFor, type IDockerOps, type LabelledContainer, type DanglingImage } from '@/lib/docker-ops';
import type { ContainerUsage } from '@/lib/container-usage';
import { findOrphanContainers } from '@/lib/orphan-containers';
import { MIN_PROXY_HIT_RETENTION_DAYS } from '@/validators/platform-settings.validator';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { createLogger } from '@/lib/logger';

const log = createLogger('admin-tools-service');

/** What the admin project drawer shows. Env var values never leave the server. */
export interface AdminProjectDetails {
  envKeys: { key: string; environment: EnvEnvironment }[];
  access: ProjectAccessEntry[];
  domains: { id: string; hostname: string; status: DomainStatus; isPrimary: boolean }[];
  usage: ContainerUsage | null;
  /** Set when the worker could not be asked for usage; the rest still loads. */
  usageError: string | null;
}

/** Per-item outcome of a cleanup run or bulk action. */
export interface CleanupResult {
  id: string;
  ok: boolean;
  error?: string;
}

/**
 * Runs `fn` for each id, one at a time so a bulk action never floods the
 * worker queue, and reports each outcome instead of stopping at the first failure.
 */
export async function forEachItem(ids: string[], fn: (id: string) => Promise<unknown>): Promise<CleanupResult[]> {
  const results: CleanupResult[] = [];
  for (const id of new Set(ids)) {
    try {
      await fn(id);
      results.push({ id, ok: true });
    } catch (err) {
      results.push({ id, ok: false, error: err instanceof Error ? err.message : 'Failed' });
    }
  }
  return results;
}

export interface ProxyHitCleanupPreview {
  retentionDays: number;
  cutoff: string;
  count: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Admin panel tools that read across projects. Callers must require CONTRIBUTOR. */
export class AdminToolsService {
  constructor(
    private readonly projectRepo: IProjectRepository,
    private readonly envVarRepo: IEnvironmentVariableRepository,
    private readonly accessRepo: IProjectAccessRepository,
    private readonly domainRepo: IDomainRepository,
    private readonly accessService: Pick<ProjectAccessService, 'revoke'>,
    private readonly docker: IDockerOps,
    private readonly proxyHits: IProxyHitRepository,
    private readonly settings: Pick<PlatformSettingsService, 'get'>,
    private readonly auditLog: Pick<IAuditLogRepository, 'create'>,
  ) {}

  async getProjectDetails(projectId: string): Promise<AdminProjectDetails> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) throw new NotFoundError('Project');

    const [envVars, access, domains, usage] = await Promise.all([
      this.envVarRepo.findByProjectId(projectId),
      this.accessRepo.listByProject(projectId),
      this.domainRepo.listByProject(projectId),
      this.docker.containerStats(containerNameFor(project.slug)).then(
        (value) => ({ value, error: null }),
        (err: unknown) => ({ value: null, error: err instanceof Error ? err.message : 'Usage unavailable' }),
      ),
    ]);

    return {
      envKeys: envVars.map(({ key, environment }) => ({ key, environment })),
      access,
      domains: domains.map(({ id, hostname, status, isPrimary }) => ({ id, hostname, status, isPrimary })),
      usage: usage.value,
      usageError: usage.error,
    };
  }

  /** Revokes a collaborator through the owner's own path, acting as the owner, and records the admin who did it. */
  async revokeAccess(projectId: string, accessId: string, actorId: string): Promise<void> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) throw new NotFoundError('Project');
    await this.accessService.revoke(projectId, project.userId, accessId);
    // Same rule as env var audits: a failed audit write never undoes the revoke.
    await this.auditLog
      .create({ action: 'ACCESS_ADMIN_REVOKED', targetKey: accessId, userId: actorId, projectId })
      .catch((err: unknown) => log.error('Failed to write audit log', { action: 'ACCESS_ADMIN_REVOKED', error: String(err) }));
  }

  // ── Cleanup: every action is previewed first, and a run re-checks it ─────

  /** Project containers whose project is gone (see findOrphanContainers for the rules). */
  async previewOrphanContainers(): Promise<LabelledContainer[]> {
    const containers = await this.docker.listTenantContainers();
    const slugs = [...new Set(containers.map((c) => c.slug))];
    // A failed lookup throws and aborts: it must never read as "no project".
    const existing = new Set(await this.projectRepo.findExistingSlugs(slugs));
    return findOrphanContainers(containers, existing);
  }

  /**
   * Removes everything the confirmed orphans left (container, images, data
   * volume, files), the same cleanup a project delete runs. Only slugs that are
   * still orphans now are touched: a project created with that slug since the
   * preview is left alone.
   */
  async removeOrphanContainers(confirmed: string[]): Promise<CleanupResult[]> {
    const orphans = new Set((await this.previewOrphanContainers()).map((c) => c.slug));
    return forEachItem(confirmed, async (slug) => {
      if (!orphans.has(slug)) throw new Error('No longer an orphan; skipped');
      await this.docker.removeProjectResources(slug);
    });
  }

  /**
   * Untagged project images. Never a rollback target: those are reached by
   * their `d-<id>` tag (Deployment.imageTag), and a tagged image is not dangling.
   */
  async previewDanglingImages(): Promise<DanglingImage[]> {
    return this.docker.listDanglingImages();
  }

  /** Reuses the deploy-time pruning per project; images a container still uses are kept. */
  async removeDanglingImages(slugs: string[]): Promise<CleanupResult[]> {
    return forEachItem(slugs, (slug) => this.docker.removeSupersededImages(slug));
  }

  async previewProxyHitCleanup(): Promise<ProxyHitCleanupPreview> {
    const { proxyHitRetentionDays } = await this.settings.get();
    const cutoff = new Date(Date.now() - proxyHitRetentionDays * DAY_MS);
    return { retentionDays: proxyHitRetentionDays, cutoff: cutoff.toISOString(), count: await this.proxyHits.countOlderThan(cutoff) };
  }

  /**
   * Deletes proxy hits older than the retention period. The caller passes the
   * period it previewed, so a settings change in between cannot widen the run.
   */
  async deleteOldProxyHits(retentionDays: number): Promise<{ deleted: number }> {
    if (!Number.isInteger(retentionDays) || retentionDays < MIN_PROXY_HIT_RETENTION_DAYS) {
      throw new ValidationError(`Proxy hits younger than ${MIN_PROXY_HIT_RETENTION_DAYS} days are never deleted`);
    }
    const { proxyHitRetentionDays } = await this.settings.get();
    if (retentionDays !== proxyHitRetentionDays) {
      throw new ConflictError('The retention setting changed since the preview; preview again');
    }
    return { deleted: await this.proxyHits.deleteOlderThan(new Date(Date.now() - retentionDays * DAY_MS)) };
  }
}

export const adminToolsService = new AdminToolsService(
  projectRepository,
  envVarRepository,
  projectAccessRepository,
  domainRepository,
  projectAccessService,
  dockerOps,
  proxyHitRepository,
  platformSettingsService,
  auditLogRepository,
);
