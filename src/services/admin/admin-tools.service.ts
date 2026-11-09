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
import { dockerOps, containerNameFor, type IDockerOps } from '@/lib/docker-ops';
import type { ContainerUsage } from '@/lib/container-usage';
import { NotFoundError } from '@/lib/errors';

/** What the admin project drawer shows. Env var values never leave the server. */
export interface AdminProjectDetails {
  envKeys: { key: string; environment: EnvEnvironment }[];
  access: ProjectAccessEntry[];
  domains: { id: string; hostname: string; status: DomainStatus; isPrimary: boolean }[];
  usage: ContainerUsage | null;
  /** Set when the worker could not be asked for usage; the rest still loads. */
  usageError: string | null;
}

/** Admin panel tools that read across projects. Callers must require CONTRIBUTOR. */
export class AdminToolsService {
  constructor(
    private readonly projectRepo: IProjectRepository,
    private readonly envVarRepo: IEnvironmentVariableRepository,
    private readonly accessRepo: IProjectAccessRepository,
    private readonly domainRepo: IDomainRepository,
    private readonly accessService: Pick<ProjectAccessService, 'revoke'>,
    private readonly docker: IDockerOps,
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

  /** Revokes a collaborator through the owner's own path, acting as the owner. */
  async revokeAccess(projectId: string, accessId: string): Promise<void> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) throw new NotFoundError('Project');
    await this.accessService.revoke(projectId, project.userId, accessId);
  }
}

export const adminToolsService = new AdminToolsService(
  projectRepository,
  envVarRepository,
  projectAccessRepository,
  domainRepository,
  projectAccessService,
  dockerOps,
);
