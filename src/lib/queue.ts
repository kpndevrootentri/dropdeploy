import { randomUUID } from 'crypto';
import { Queue } from 'bullmq';
import { getRedisConnection } from '@/lib/redis';
import type { DeploymentJob } from '@/types/deployment.types';

const QUEUE_NAME = 'deployments';

let deploymentQueue: Queue<DeploymentJob> | null = null;

/**
 * Returns the deployment queue instance (BullMQ).
 * Use in API routes or server context only.
 */
export function getDeploymentQueue(): Queue<DeploymentJob> {
  if (!deploymentQueue) {
    deploymentQueue = new Queue<DeploymentJob>(QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        // One attempt: a failed build almost always fails the same way again,
        // and each retry is another full, resource-heavy build (a timed-out
        // one would burn 3x the timeout). Users retry explicitly instead.
        attempts: 1,
        removeOnComplete: { count: 100 },
      },
    });
  }
  return deploymentQueue as Queue<DeploymentJob>;
}

export interface IDeploymentQueue {
  add(job: DeploymentJob): Promise<string>;
  /** Remove a waiting job by deploymentId. Resolves silently if the job is not found. */
  remove(deploymentId: string): Promise<void>;
  /**
   * Re-queue a failed job. If the job still exists in BullMQ's failed set,
   * it is moved back to waiting via job.retry(). If it has been cleaned up,
   * a fresh job is added with the same jobId.
   */
  retryFailed(deploymentId: string, fallbackJob: DeploymentJob): Promise<void>;
}

export const deploymentQueueAdapter: IDeploymentQueue = {
  async add(job: DeploymentJob): Promise<string> {
    const result = await getDeploymentQueue().add('deploy', job, {
      jobId: job.deploymentId,
    });
    return result.id ?? '';
  },
  async remove(deploymentId: string): Promise<void> {
    const job = await getDeploymentQueue().getJob(deploymentId);
    if (job) {
      await job.remove();
    }
  },
  async retryFailed(deploymentId: string, fallbackJob: DeploymentJob): Promise<void> {
    const job = await getDeploymentQueue().getJob(deploymentId);
    if (job) {
      await job.retry('failed');
    } else {
      await getDeploymentQueue().add('deploy', fallbackJob, { jobId: deploymentId });
    }
  },
};

export const NOTIFICATION_QUEUE = 'notifications';

/** One delivery to one hook. Holds neither the hook's URL nor its secret: the worker reads them from the DB. */
export interface NotificationJob {
  hookId: string;
  event: string;
  payload: Record<string, unknown>;
}

let notificationQueue: Queue<NotificationJob> | null = null;

export function getNotificationQueue(): Queue<NotificationJob> {
  if (!notificationQueue) {
    notificationQueue = new Queue<NotificationJob>(NOTIFICATION_QUEUE, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        // Retries after 30s, 1m, 2m and 4m, then the delivery is dropped.
        attempts: 5,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 500 },
      },
    });
  }
  return notificationQueue;
}

export interface INotificationQueue {
  add(job: NotificationJob): Promise<void>;
}

export const notificationQueueAdapter: INotificationQueue = {
  async add(job: NotificationJob): Promise<void> {
    // A UUID, not BullMQ's counter: receivers dedupe on it, and the counter restarts with Redis.
    await getNotificationQueue().add(job.event, job, { jobId: randomUUID() });
  },
};
