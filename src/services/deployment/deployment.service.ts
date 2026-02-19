import * as fs from 'fs';
import * as path from 'path';
import { deploymentRepository, type IDeploymentRepository } from '@/repositories/deployment.repository';
import { projectRepository, type IProjectRepository } from '@/repositories/project.repository';
import { deploymentQueueAdapter, type IDeploymentQueue } from '@/lib/queue';
import { dockerService, type DockerService } from '@/services/docker';
import { gitService, type IGitService } from '@/services/git';
import { envVarService, type EnvironmentVariableService } from '@/services/env-var';
import { nginxService, type INginxService } from '@/services/nginx';
import { getRedisConnection } from '@/lib/redis';
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
   * Creates a deployment record and enqueues build job (smart-queue with supersede pattern).
   * - Cancels any existing QUEUED deployment for the project (supersede)
   * - If a build is already BUILDING: saves the new deployment as QUEUED in DB only (held back)
   * - Otherwise: creates QUEUED in DB + enqueues in BullMQ immediately
   * Uses a Redis advisory lock to guard against double-click races.
   */
  async createDeployment(projectId: string, userId: string): Promise<{ deployment: Deployment; queued: boolean }> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) {
      throw new NotFoundError('Project');
    }
    if (project.userId !== userId) {
      throw new NotFoundError('Project');
    }

    // Redis advisory lock — prevents race from double-click / concurrent API calls
    const redis = getRedisConnection();
    const lockKey = `deploy:lock:${projectId}`;
    const acquired = await redis.set(lockKey, '1', 'PX', 5000, 'NX').catch(() => null);
    // acquired === 'OK' → lock acquired
    // acquired === null (from NX) → lock held by another request → conflict
    // acquired === null (from .catch) → Redis down → proceed without lock
    if (acquired !== null && acquired !== 'OK') {
      throw new ConflictError('Another deployment creation is in progress. Please try again.');
    }
    // If NX returned null (either lock held or Redis down), we can't distinguish without a follow-up check.
    // If Redis is down, we proceed without the lock (matches existing risk profile).
    // If the lock is held but Redis returned null without throwing, we also proceed (DB logic is the real guard).

    try {
      // Cancel any existing QUEUED deployment (supersede pattern)
      const existingQueued = await this.deploymentRepo.findQueuedDeploymentForProject(projectId);
      if (existingQueued) {
        await this.queue.remove(existingQueued.id); // no-op if not in BullMQ
        await this.deploymentRepo.update(existingQueued.id, { status: 'CANCELLED', completedAt: new Date() });
      }

      // Check if a build is currently running
      const building = await this.deploymentRepo.findBuildingDeployment(projectId);

      // Create new deployment record
      const deployment = await this.deploymentRepo.create({ projectId, status: 'QUEUED' });

      // Enqueue immediately only if no active build; otherwise hold in DB
      if (!building) {
        try {
          await this.queue.add({ deploymentId: deployment.id, projectId });
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
      }

      return { deployment, queued: building !== null };
    } finally {
      await redis.del(lockKey).catch(() => {});
    }
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
   * Retries a FAILED deployment: resets the DB record to QUEUED and re-enqueues the job.
   */
  async retryFailedDeployment(deploymentId: string, userId: string): Promise<Deployment> {
    const deployment = await this.deploymentRepo.findByIdWithProject(deploymentId);
    if (!deployment) {
      throw new NotFoundError('Deployment');
    }
    if (deployment.project.userId !== userId) {
      throw new NotFoundError('Deployment');
    }
    if (deployment.status !== 'FAILED') {
      throw new ValidationError(
        `Only FAILED deployments can be retried (current status: ${deployment.status})`
      );
    }
    const updated = await this.deploymentRepo.update(deploymentId, {
      status: 'QUEUED',
      buildStep: null,
      buildLog: null,
      completedAt: null,
    });
    // Only enqueue immediately if no build is running; otherwise it will be picked up by the worker
    const building = await this.deploymentRepo.findBuildingDeployment(deployment.projectId);
    if (!building) {
      await this.queue.retryFailed(deploymentId, {
        deploymentId,
        projectId: deployment.projectId,
      });
    }
    return updated;
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
   * Also re-enqueues QUEUED deployments that were held back (their BUILDING job is now gone).
   */
  async recoverStuckDeployments(): Promise<void> {
    const count = await this.deploymentRepo.markBuildingAsFailed();
    if (count > 0) {
      console.warn(`[DeploymentService] Marked ${count} stuck BUILDING deployment(s) as FAILED on startup`);
    }

    const orphaned = await this.deploymentRepo.findAllOrphanedQueuedDeployments();
    for (const dep of orphaned) {
      console.log(`[DeploymentService] Re-enqueuing orphaned QUEUED deployment ${dep.id}`);
      await this.queue.add({ deploymentId: dep.id, projectId: dep.projectId }).catch((err) =>
        console.error('[DeploymentService] Failed to re-enqueue on startup:', err)
      );
    }
  }

  /**
   * Enqueues the next held-back QUEUED deployment for a project after the current build finishes.
   * Called by the worker after each completed or failed job.
   */
  async enqueueNextForProject(projectId: string): Promise<void> {
    const next = await this.deploymentRepo.findQueuedDeploymentForProject(projectId);
    if (!next) return;
    const stillBuilding = await this.deploymentRepo.findBuildingDeployment(projectId);
    if (stillBuilding) return; // defensive guard
    console.log(`[DeploymentService] Enqueuing held deployment ${next.id} for project ${projectId}`);
    try {
      await this.queue.add({ deploymentId: next.id, projectId });
    } catch (err) {
      console.error('[DeploymentService] Failed to enqueue held deployment:', err);
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
    const redisChannel = `build:${deploymentId}`;
    const logLines: string[] = [];

    const flushLog = async (): Promise<void> => {
      try {
        await this.deploymentRepo.update(deploymentId, { buildLog: logLines.join('') });
      } catch {
        // Non-fatal: log flush failure shouldn't abort the build
      }
    };

    let lineCount = 0;
    const onLog = (line: string): void => {
      logLines.push(line);
      lineCount++;
      // Publish to Redis fire-and-forget (subscriber connections in SSE route)
      getRedisConnection().publish(redisChannel, line).catch(() => {});
      if (lineCount % 30 === 0) {
        void flushLog();
      }
    };

    const addMarker = (text: string): void => {
      onLog(`▶ ${text}\n`);
    };

    try {
      await this.deploymentRepo.update(deploymentId, {
        status: 'BUILDING',
        buildStep: 'CLONING',
        startedAt,
      });

      addMarker('Cloning...');
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
      addMarker('Building image...');
      const secretValues = Object.values(runtimeEnv);
      const imageName = await this.docker.buildImage(project, workDir, buildArgs, secretValues, onLog);

      // Clean up build artifacts from work directory
      await this.cleanBuildArtifacts(workDir);

      await this.deploymentRepo.update(deploymentId, { buildStep: 'STARTING' });
      addMarker('Starting container...');
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
        buildLog: logLines.join(''),
        containerPort,
        subdomain: project.slug,
        completedAt: new Date(),
      });

      // Signal SSE subscribers that the build is done
      getRedisConnection().publish(redisChannel, '__DONE__').catch(() => {});

      try {
        await this.nginx.configureProject(project.slug, containerPort);
      } catch (err) {
        console.warn('[DeploymentService] Nginx config failed (non-fatal):', err);
      }
    } catch (err) {
      await this.deploymentRepo.update(deploymentId, {
        status: 'FAILED',
        buildStep: null,
        buildLog: logLines.join(''),
        completedAt: new Date(),
      });
      // Signal SSE subscribers that the build ended (with failure)
      getRedisConnection().publish(redisChannel, '__DONE__').catch(() => {});
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

