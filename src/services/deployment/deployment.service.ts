import * as fs from 'fs';
import * as path from 'path';
import { deploymentRepository, type IDeploymentRepository } from '@/repositories/deployment.repository';
import { projectRepository, type IProjectRepository } from '@/repositories/project.repository';
import { deploymentQueueAdapter, type IDeploymentQueue } from '@/lib/queue';
import { dockerService, type DockerService } from '@/services/docker';
import { gitService, type IGitService } from '@/services/git';
import { envVarService, type EnvironmentVariableService } from '@/services/env-var';
import { nginxService, type INginxService } from '@/services/nginx';
import { NotFoundError, ConflictError, ValidationError } from '@/lib/errors';
import type { Deployment } from '@prisma/client';

export class DeploymentService {
  constructor (
    private readonly deploymentRepo: IDeploymentRepository,
    private readonly projectRepo: IProjectRepository,
    private readonly queue: IDeploymentQueue,
    private readonly docker: DockerService,
    private readonly git: IGitService,
    private readonly envVar: EnvironmentVariableService,
    private readonly nginx: INginxService,
  ) { }

  /**
   * Creates a deployment record and enqueues build job.
   * If the queue (Redis) is unavailable, the deployment is still created; the job can be retried later.
   */
  async createDeployment(projectId: string, userId: string): Promise<Deployment> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) {
      throw new NotFoundError('Project');
    }
    if (project.userId !== userId) {
      throw new NotFoundError('Project');
    }
    const active = await this.deploymentRepo.hasActiveDeployment(projectId);
    if (active) {
      throw new ConflictError('A deployment is already in progress for this project');
    }
    const deployment = await this.deploymentRepo.create({ projectId, status: 'QUEUED' });
    try {
      await this.queue.add({
        deploymentId: deployment.id,
        projectId,
      });
    } catch (err) {
      const isConnectionError =
        (err as NodeJS.ErrnoException)?.code === 'ECONNREFUSED' ||
        (err as Error)?.message?.includes('ECONNREFUSED') ||
        err instanceof AggregateError;
      if (isConnectionError) {
        console.warn(
          '[DeploymentService] Queue unavailable (Redis not running?). Deployment created but not queued:',
          deployment.id
        );
      } else {
        throw err;
      }
    }
    return deployment;
  }

  /**
   * Fetches deployment by id; ensures user owns the project.
   */
  async getById(deploymentId: string, userId: string): Promise<Deployment> {
    const deployment = await this.deploymentRepo.findByIdWithProject(deploymentId);
    if (!deployment) {
      throw new NotFoundError('Deployment');
    }
    if (deployment.project.userId !== userId) {
      throw new NotFoundError('Deployment');
    }
    const { project: _p, ...deploymentOnly } = deployment;
    return deploymentOnly;
  }

  /**
   * Cancels a QUEUED deployment: removes it from the queue and marks it CANCELLED.
   * Throws if the deployment is not in QUEUED state (already building or terminal).
   */
  async cancelDeployment(deploymentId: string, userId: string): Promise<Deployment> {
    const deployment = await this.deploymentRepo.findByIdWithProject(deploymentId);
    if (!deployment) {
      throw new NotFoundError('Deployment');
    }
    if (deployment.project.userId !== userId) {
      throw new NotFoundError('Deployment');
    }
    if (deployment.status !== 'QUEUED') {
      throw new ValidationError(
        `Only QUEUED deployments can be cancelled (current status: ${deployment.status})`
      );
    }
    await this.queue.remove(deploymentId);
    return this.deploymentRepo.update(deploymentId, {
      status: 'CANCELLED',
      completedAt: new Date(),
    });
  }

  /**
   * Lists deployments for a project.
   */
  async listByProjectId(projectId: string, userId: string, limit = 10): Promise<Deployment[]> {
    const project = await this.projectRepo.findById(projectId);
    if (!project || project.userId !== userId) {
      throw new NotFoundError('Project');
    }
    return this.deploymentRepo.findByProjectId(projectId, limit);
  }

  /**
   * Marks all BUILDING deployments as FAILED. Called once on worker startup to
   * recover from a previous crash where builds were left in an indeterminate state.
   */
  async recoverStuckDeployments(): Promise<void> {
    const count = await this.deploymentRepo.markBuildingAsFailed();
    if (count > 0) {
      console.warn(`[DeploymentService] Marked ${count} stuck BUILDING deployment(s) as FAILED on startup`);
    }
  }

  /**
   * Process job: clone/pull repo, build image, run container. Called by worker.
   * Uses clone-once strategy: first deploy clones, subsequent deploys pull latest.
   */
  async buildAndDeploy(deploymentId: string): Promise<void> {
    const deployment = await this.deploymentRepo.findByIdWithProject(deploymentId);
    if (!deployment) {
      console.warn(
        '[DeploymentService] Deployment not found (stale or deleted job):',
        deploymentId
      );
      return;
    }
    const { project } = deployment;
    if (!project.githubUrl) {
      await this.deploymentRepo.update(deploymentId, { status: 'FAILED' });
      return;
    }

    const startedAt = new Date();

    try {
      await this.deploymentRepo.update(deploymentId, {
        status: 'BUILDING',
        buildStep: 'CLONING',
        startedAt,
      });

      const { workDir, commitHash } = await this.git.ensureRepo(
        project.githubUrl,
        project.slug,
        project.branch,
      );
      await this.deploymentRepo.update(deploymentId, { commitHash });

      // Resolve env vars: split into build args (NEXT_PUBLIC_*) and runtime env
      const allEnvVars = await this.envVar.resolveForDeployment(project.id);
      const buildArgs: Record<string, string> = {};
      const runtimeEnv: Record<string, string> = {};
      for (const [key, value] of Object.entries(allEnvVars)) {
        if (key.startsWith('NEXT_PUBLIC_') && project.type === 'NEXTJS') {
          buildArgs[key] = value;
        } else {
          runtimeEnv[key] = value;
        }
      }

      await this.deploymentRepo.update(deploymentId, { buildStep: 'BUILDING_IMAGE' });
      const secretValues = Object.values(runtimeEnv);
      const imageName = await this.docker.buildImage(project, workDir, buildArgs, secretValues);

      // Clean up build artifacts from work directory
      await this.cleanBuildArtifacts(workDir);

      await this.deploymentRepo.update(deploymentId, { buildStep: 'STARTING' });
      const activePorts = await this.deploymentRepo.findActiveContainerPorts();
      const containerPort = await this.docker.runContainer(
        imageName,
        project.type,
        `dropdeploy-${project.slug}`,
        runtimeEnv,
        activePorts,
      );

      await this.deploymentRepo.clearSubdomainForOtherDeployments(
        project.id,
        project.slug,
        deploymentId
      );
      await this.deploymentRepo.clearPortForOtherDeployments(project.id, deploymentId);

      await this.deploymentRepo.update(deploymentId, {
        status: 'DEPLOYED',
        buildStep: null,
        containerPort,
        subdomain: project.slug,
        completedAt: new Date(),
      });

      try {
        await this.nginx.configureProject(project.slug, containerPort);
      } catch (err) {
        console.warn('[DeploymentService] Nginx config failed (non-fatal):', err);
      }
    } catch (err) {
      await this.deploymentRepo.update(deploymentId, {
        status: 'FAILED',
        buildStep: null,
        completedAt: new Date(),
      });
      throw err;
    }
  }
  /**
   * Remove generated Dockerfile and any .env files from the work directory
   * after Docker build to prevent secrets lingering on disk.
   */
  private async cleanBuildArtifacts(workDir: string): Promise<void> {
    const filesToClean = ['Dockerfile', '.dockerignore'];
    for (const file of filesToClean) {
      try {
        await fs.promises.unlink(path.join(workDir, file));
      } catch {
        // File may not exist — that's fine
      }
    }

    // Remove any .env* files that the repo might contain
    try {
      const entries = await fs.promises.readdir(workDir);
      for (const entry of entries) {
        if (entry.startsWith('.env')) {
          await fs.promises.unlink(path.join(workDir, entry));
        }
      }
    } catch {
      // Non-critical — log and continue
      console.warn('[DeploymentService] Failed to clean .env files from workDir');
    }
  }
}

export const deploymentService = new DeploymentService(
  deploymentRepository,
  projectRepository,
  deploymentQueueAdapter,
  dockerService,
  gitService,
  envVarService,
  nginxService,
);

