import type { Deployment, Project, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export type DeploymentWithProject = Deployment & { project: Project };

export interface IDeploymentRepository {
  findById(id: string): Promise<Deployment | null>;
  findByIdWithProject(id: string): Promise<DeploymentWithProject | null>;
  findByProjectId(projectId: string, limit?: number, skip?: number): Promise<Deployment[]>;
  countByProjectId(projectId: string): Promise<number>;
  create(data: { projectId: string; status?: string }): Promise<Deployment>;
  update(id: string, data: Partial<Pick<Deployment, 'status' | 'containerPort' | 'subdomain' | 'buildStep' | 'buildLog' | 'commitHash' | 'startedAt' | 'completedAt'>>): Promise<Deployment>;
  /** Clear subdomain on other deployments of this project so the given deployment can claim it (avoids unique constraint). */
  clearSubdomainForOtherDeployments(
    projectId: string,
    subdomain: string,
    excludeDeploymentId: string
  ): Promise<void>;
  /** Returns all host ports currently held by DEPLOYED deployments (used to avoid port collisions). */
  findActiveContainerPorts(): Promise<number[]>;
  /** Clears containerPort on all other deployments of this project (release-on-redeploy). */
  clearPortForOtherDeployments(projectId: string, excludeDeploymentId: string): Promise<void>;
  /** Returns the BUILDING deployment for the project, or null if none. */
  findBuildingDeployment(projectId: string): Promise<Deployment | null>;
  /** Returns the oldest QUEUED deployment for the project, or null if none. */
  findQueuedDeploymentForProject(projectId: string): Promise<Deployment | null>;
  /**
   * Returns one QUEUED deployment per project that has no BUILDING deployment (oldest first).
   * Used by recoverStuckDeployments() on worker startup.
   */
  findAllOrphanedQueuedDeployments(): Promise<Deployment[]>;
  /**
   * Marks all BUILDING deployments as FAILED with completedAt = now.
   * Called on worker startup to clean up deployments stuck from a previous crash.
   * Returns the number of rows updated.
   */
  markBuildingAsFailed(): Promise<number>;
}

export class DeploymentRepository implements IDeploymentRepository {
  async findById(id: string): Promise<Deployment | null> {
    return prisma.deployment.findUnique({ where: { id } });
  }

  async findByIdWithProject(id: string): Promise<DeploymentWithProject | null> {
    return prisma.deployment.findUnique({
      where: { id },
      include: { project: true },
    });
  }

  async findByProjectId(projectId: string, limit = 10, skip = 0): Promise<Deployment[]> {
    return prisma.deployment.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip,
    });
  }

  async countByProjectId(projectId: string): Promise<number> {
    return prisma.deployment.count({ where: { projectId } });
  }

  async create(data: { projectId: string; status?: string }): Promise<Deployment> {
    return prisma.deployment.create({
      data: {
        projectId: data.projectId,
        status: (data.status as 'QUEUED') ?? 'QUEUED',
      },
    });
  }

  async update(
    id: string,
    data: Partial<Pick<Deployment, 'status' | 'containerPort' | 'subdomain' | 'buildStep' | 'buildLog' | 'commitHash' | 'startedAt' | 'completedAt'>>
  ): Promise<Deployment> {
    return prisma.deployment.update({
      where: { id },
      data: data as Prisma.DeploymentUpdateInput,
    });
  }

  async clearSubdomainForOtherDeployments(
    projectId: string,
    subdomain: string,
    excludeDeploymentId: string
  ): Promise<void> {
    await prisma.deployment.updateMany({
      where: {
        projectId,
        subdomain,
        id: { not: excludeDeploymentId },
      },
      data: { subdomain: null },
    });
  }

  async findActiveContainerPorts(): Promise<number[]> {
    const rows = await prisma.deployment.findMany({
      where: { status: 'DEPLOYED', containerPort: { not: null } },
      select: { containerPort: true },
    });
    return rows.map((r) => r.containerPort as number);
  }

  async clearPortForOtherDeployments(projectId: string, excludeDeploymentId: string): Promise<void> {
    await prisma.deployment.updateMany({
      where: { projectId, id: { not: excludeDeploymentId } },
      data: { containerPort: null },
    });
  }

  async findBuildingDeployment(projectId: string): Promise<Deployment | null> {
    return prisma.deployment.findFirst({ where: { projectId, status: 'BUILDING' } });
  }

  async findQueuedDeploymentForProject(projectId: string): Promise<Deployment | null> {
    return prisma.deployment.findFirst({
      where: { projectId, status: 'QUEUED' },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findAllOrphanedQueuedDeployments(): Promise<Deployment[]> {
    const buildingRows = await prisma.deployment.findMany({
      where: { status: 'BUILDING' },
      select: { projectId: true },
      distinct: ['projectId'],
    });
    const buildingProjectIds = new Set(buildingRows.map((r) => r.projectId));

    const rows = await prisma.deployment.findMany({
      where: { status: 'QUEUED', projectId: { notIn: [...buildingProjectIds] } },
      orderBy: { createdAt: 'asc' },
    });
    const seen = new Set<string>();
    return rows.filter((r) => !seen.has(r.projectId) && seen.add(r.projectId));
  }

  async markBuildingAsFailed(): Promise<number> {
    const result = await prisma.deployment.updateMany({
      where: { status: 'BUILDING' },
      data: { status: 'FAILED', buildStep: null, completedAt: new Date() },
    });
    return result.count;
  }
}

export const deploymentRepository = new DeploymentRepository();
