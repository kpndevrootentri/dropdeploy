/**
 * BullMQ worker for deployment jobs (PRD §5.4, §5.5).
 * Run with: npm run worker
 * Requires REDIS_* and DATABASE_URL. Docker build/deploy logic is stubbed.
 */

import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { getRedisConnection } from '@/lib/redis';
import { getConfig } from '@/lib/config';
import { deploymentService } from '@/services/deployment';
import type { DeploymentJob } from '@/types/deployment.types';

const QUEUE_NAME = 'deployments';
const HEARTBEAT_KEY = 'worker:health';
const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TTL_S = 90;

async function processJob(job: Job<DeploymentJob>): Promise<void> {
  const { deploymentId, projectId } = job.data;
  const timeoutMs = getConfig().BULLMQ_JOB_TIMEOUT_MS;
  console.log(`[worker] Processing deployment ${deploymentId} for project ${projectId} (timeout ${timeoutMs}ms)`);

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`Job timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    await Promise.race([
      deploymentService.buildAndDeploy(deploymentId),
      timeoutPromise,
    ]);
    console.log(`[worker] Deployment ${deploymentId} completed`);
  } catch (error) {
    console.error(`[worker] Deployment ${deploymentId} failed:`, error);
    throw error;
  } finally {
    if (timeoutHandle !== null) clearTimeout(timeoutHandle);
  }
}

function startHeartbeat(redis: Redis): ReturnType<typeof setInterval> {
  const startedAt = new Date().toISOString();
  const pid = process.pid;

  const write = (): void => {
    const value = JSON.stringify({ pid, startedAt, timestamp: new Date().toISOString() });
    redis.set(HEARTBEAT_KEY, value, 'EX', HEARTBEAT_TTL_S).catch((err) => {
      console.warn('[worker] Heartbeat write failed:', err);
    });
  };

  write();
  return setInterval(write, HEARTBEAT_INTERVAL_MS);
}

async function main(): Promise<void> {
  await deploymentService.recoverStuckDeployments();

  const redis = getRedisConnection();

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
    void deploymentService.enqueueNextForProject(job.data.projectId).catch((err) =>
      console.error('[worker] enqueueNextForProject error after completion:', err)
    );
  });

  worker.on('failed', (job, err) => {
    console.error(`[worker] Job ${job?.id} failed:`, err?.message);
    if (job?.data?.projectId) {
      void deploymentService.enqueueNextForProject(job.data.projectId).catch((e) =>
        console.error('[worker] enqueueNextForProject error after failure:', e)
      );
    }
  });

  const heartbeatTimer = startHeartbeat(redis);

  const shutdown = async (): Promise<void> => {
    console.log('[worker] Shutting down...');
    clearInterval(heartbeatTimer);
    await redis.del(HEARTBEAT_KEY).catch(() => {});
    await worker.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => { void shutdown(); });
  process.on('SIGINT', () => { void shutdown(); });

  console.log('[worker] Deployment worker started');
}

main().catch((err) => {
  console.error('[worker] Startup failed:', err);
  process.exit(1);
});
