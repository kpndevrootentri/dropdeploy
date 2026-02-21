/**
 * BullMQ worker for deployment jobs (PRD §5.4, §5.5).
 * Run with: npm run worker
 * Requires REDIS_* and DATABASE_URL. Docker build/deploy logic is stubbed.
 */

import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { getRedisConnection } from '@/lib/redis';
import { getConfig } from '@/lib/config';
import { createLogger } from '@/lib/logger';
import { deploymentService } from '@/services/deployment';
import type { DeploymentJob } from '@/types/deployment.types';

const log = createLogger('worker');

const QUEUE_NAME = 'deployments';
const HEARTBEAT_KEY = 'worker:health';
const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TTL_S = 90;

async function processJob(job: Job<DeploymentJob>): Promise<void> {
  const { deploymentId, projectId } = job.data;
  const timeoutMs = getConfig().BULLMQ_JOB_TIMEOUT_MS;
  log.info('Processing deployment', { deploymentId, projectId, timeoutMs });

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
    log.info('Deployment completed', { deploymentId });
  } catch (error) {
    log.error('Deployment failed', { deploymentId, error: error instanceof Error ? error.message : String(error) });
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
      log.warn('Heartbeat write failed', { error: String(err) });
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
    log.info('Job completed', { jobId: job.id, projectId: job.data.projectId });
    void deploymentService.enqueueNextForProject(job.data.projectId).catch((err) =>
      log.error('enqueueNextForProject error after completion', { error: String(err) })
    );
  });

  worker.on('failed', (job, err) => {
    log.error('Job failed', { jobId: job?.id, error: err?.message });
    if (job?.data?.projectId) {
      void deploymentService.enqueueNextForProject(job.data.projectId).catch((e) =>
        log.error('enqueueNextForProject error after failure', { error: String(e) })
      );
    }
  });

  const heartbeatTimer = startHeartbeat(redis);

  const shutdown = async (): Promise<void> => {
    log.info('Shutting down...');
    clearInterval(heartbeatTimer);
    await redis.del(HEARTBEAT_KEY).catch(() => {});
    await worker.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => { void shutdown(); });
  process.on('SIGINT', () => { void shutdown(); });

  log.info('Deployment worker started');
}

main().catch((err) => {
  // Intentional console.error: logger may not be initialized yet at this point
  // eslint-disable-next-line no-console
  console.error('[worker] Startup failed:', err);
  process.exit(1);
});
