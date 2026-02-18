/**
 * BullMQ worker for deployment jobs (PRD §5.4, §5.5).
 * Run with: npm run worker
 * Requires REDIS_* and DATABASE_URL. Docker build/deploy logic is stubbed.
 */

import { Worker, type Job } from 'bullmq';
import { getRedisConnection } from '@/lib/redis';
import { getConfig } from '@/lib/config';
import { deploymentService } from '@/services/deployment';
import type { DeploymentJob } from '@/types/deployment.types';

const QUEUE_NAME = 'deployments';

async function processJob(job: Job<DeploymentJob>): Promise<void> {
  const { deploymentId, projectId } = job.data;
  console.log(`[worker] Processing deployment ${deploymentId} for project ${projectId}`);
  try {
    await deploymentService.buildAndDeploy(deploymentId);
    console.log(`[worker] Deployment ${deploymentId} completed`);
  } catch (error) {
    console.error(`[worker] Deployment ${deploymentId} failed:`, error);
    throw error;
  }
}

async function main(): Promise<void> {
  await deploymentService.recoverStuckDeployments();

  const worker = new Worker<DeploymentJob>(
    QUEUE_NAME,
    processJob,
    {
      connection: getRedisConnection(),
      concurrency: getConfig().BULLMQ_CONCURRENCY,
    }
  );

  worker.on('completed', (job) => {
    console.log(`[worker] Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[worker] Job ${job?.id} failed:`, err?.message);
  });

  console.log('[worker] Deployment worker started');
}

main().catch((err) => {
  console.error('[worker] Startup failed:', err);
  process.exit(1);
});
