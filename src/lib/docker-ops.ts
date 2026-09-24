/**
 * Docker operations the web app needs, executed by the deployment worker.
 *
 * The web process must not hold the Docker socket: it parses every request
 * from the internet (and proxies every tenant site), so any remote-code bug in
 * it would otherwise be one `docker run -v /:/host --privileged` away from root
 * on the host. Instead it asks the worker — the only process that runs with
 * Docker access — over a BullMQ queue, and waits for the answer.
 *
 * The worker accepts a fixed set of operations on `dropdeploy-*` containers
 * only (see src/workers/docker-ops.processor.ts), so even full control of the
 * web process, or of Redis, reaches tenant containers and never the host.
 *
 * This file is the web side. Running the web process as a user outside the
 * `docker` group is what makes the separation real — see
 * docs/deployment.md, "Run the web app without Docker access".
 */

import { Queue, QueueEvents } from 'bullmq';
import { createRedisConnection } from '@/lib/redis';
import { AppError } from '@/lib/errors';

export const DOCKER_OPS_QUEUE = 'docker-ops';

export type DockerOpRequest =
  | { op: 'terminal'; containerName: string; command: string }
  | { op: 'containerInfo'; containerName: string }
  | { op: 'stopContainer'; containerName: string }
  | { op: 'restartContainer'; containerName: string }
  | { op: 'removeProjectResources'; slug: string };

/**
 * What the worker returns. User-facing failures (a disallowed terminal
 * command, a stopped container) come back as `ok: false` with their message;
 * internal failures fail the job and reach the caller only as a generic error.
 */
export type DockerOpResult =
  | { ok: true; value: unknown }
  | { ok: false; code: string; message: string; status: number };

export interface ContainerInfo {
  id: string;
  status: string;
  running: boolean;
  startedAt: string;
  image: string;
  ports: { hostPort: number; containerPort: number }[];
  cpuLimit: number;
  memoryLimitBytes: number;
  restartCount: number;
}

export interface TerminalResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Container and image names are derived from the slug the same way everywhere. */
export const containerNameFor = (slug: string): string => `dropdeploy-${slug}`;

/** Time the web side waits per operation; a terminal command runs up to 30s. */
const TIMEOUT_MS: Record<DockerOpRequest['op'], number> = {
  terminal: 40_000,
  containerInfo: 10_000,
  stopContainer: 30_000,
  restartContainer: 30_000,
  removeProjectResources: 60_000,
};

let queue: Queue<DockerOpRequest, DockerOpResult> | null = null;
let events: QueueEvents | null = null;

function getQueue(): Queue<DockerOpRequest, DockerOpResult> {
  if (!queue) {
    queue = new Queue<DockerOpRequest, DockerOpResult>(DOCKER_OPS_QUEUE, {
      connection: createRedisConnection(),
      // Terminal output can include environment variables. Keep results and
      // the event stream that carries them around only briefly.
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { age: 60, count: 100 },
        removeOnFail: { age: 60, count: 100 },
      },
      streams: { events: { maxLen: 100 } },
    });
  }
  return queue;
}

async function getEvents(): Promise<QueueEvents> {
  if (!events) {
    // QueueEvents blocks on its connection, so it gets its own.
    events = new QueueEvents(DOCKER_OPS_QUEUE, { connection: createRedisConnection() });
  }
  await events.waitUntilReady();
  return events;
}

async function call<T>(request: DockerOpRequest): Promise<T> {
  const queueEvents = await getEvents();
  const job = await getQueue().add(request.op, request);

  let result: DockerOpResult;
  try {
    result = await job.waitUntilFinished(queueEvents, TIMEOUT_MS[request.op]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/timed out/i.test(message)) {
      throw new AppError(
        'WORKER_UNAVAILABLE',
        'The deployment worker did not respond. Try again in a moment.',
        503,
      );
    }
    // The worker failed the job: an internal error it has already logged.
    throw new AppError('DOCKER_OPERATION_FAILED', 'The operation could not be completed.', 502);
  }

  if (!result.ok) {
    throw new AppError(result.code, result.message, result.status);
  }
  return result.value as T;
}

/** Client used by the web process; implemented over the worker queue. */
export interface IDockerOps {
  terminal(containerName: string, command: string): Promise<TerminalResult>;
  containerInfo(containerName: string): Promise<ContainerInfo | null>;
  stopContainer(containerName: string): Promise<void>;
  restartContainer(containerName: string): Promise<void>;
  /** Container, images, served static files and git clone of a deleted project. */
  removeProjectResources(slug: string): Promise<void>;
}

export const dockerOps: IDockerOps = {
  terminal: (containerName, command) => call({ op: 'terminal', containerName, command }),
  containerInfo: (containerName) => call({ op: 'containerInfo', containerName }),
  stopContainer: (containerName) => call({ op: 'stopContainer', containerName }),
  restartContainer: (containerName) => call({ op: 'restartContainer', containerName }),
  removeProjectResources: (slug) => call({ op: 'removeProjectResources', slug }),
};
