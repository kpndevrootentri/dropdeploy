/**
 * Worker side of src/lib/docker-ops.ts: runs Docker operations on behalf of
 * the web process, which has no Docker access of its own.
 *
 * This is now the boundary the socket sits behind, so it trusts nothing about
 * the request beyond its shape: only the listed operations exist, and only
 * containers named `dropdeploy-<slug>` can be touched. Anything that can write
 * to this queue — the web app, or whoever controls it — can therefore reach
 * tenant containers, never the platform's own (Caddy, databases) or the host.
 */

import type { Job } from 'bullmq';
import { AppError } from '@/lib/errors';
import { createLogger } from '@/lib/logger';
import type { DockerOpRequest, DockerOpResult } from '@/lib/docker-ops';
import { dockerService } from '@/services/docker';
import { dockerTerminalService } from '@/services/docker/docker-terminal.service';
import { removeProjectResources } from '@/services/project/project-cleanup';

const log = createLogger('docker-ops');

/** Same alphabet project slugs are generated from (see project.repository). */
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const CONTAINER_NAME = /^dropdeploy-[a-z0-9][a-z0-9-]{0,62}$/;

class RejectedRequestError extends AppError {
  constructor(message: string) {
    super('INVALID_DOCKER_OPERATION', message, 400);
  }
}

function assertContainerName(name: unknown): string {
  if (typeof name !== 'string' || !CONTAINER_NAME.test(name)) {
    throw new RejectedRequestError('Not a project container');
  }
  return name;
}

async function run(request: DockerOpRequest): Promise<unknown> {
  switch (request.op) {
    case 'terminal': {
      const containerName = assertContainerName(request.containerName);
      if (typeof request.command !== 'string' || request.command.length > 1000) {
        throw new RejectedRequestError('Invalid command');
      }
      return request.command.startsWith('/')
        ? dockerTerminalService.executeSlashCommand(containerName, request.command)
        : dockerTerminalService.executeCommand(containerName, request.command);
    }
    case 'containerInfo':
      return dockerService.getContainerInfo(assertContainerName(request.containerName));
    case 'stopContainer':
      await dockerService.stopContainer(assertContainerName(request.containerName));
      return null;
    case 'restartContainer':
      await dockerService.restartContainer(assertContainerName(request.containerName));
      return null;
    case 'removeProjectResources':
      if (typeof request.slug !== 'string' || !SLUG.test(request.slug)) {
        throw new RejectedRequestError('Invalid project slug');
      }
      await removeProjectResources(request.slug, dockerService);
      return null;
    default:
      throw new RejectedRequestError('Unknown operation');
  }
}

/**
 * BullMQ processor. User-facing errors (AppError: a disallowed terminal
 * command, a stopped container, a rejected request) are returned so the web
 * side can show them; anything else is logged here and fails the job, which
 * the web side reports generically.
 */
export async function processDockerOp(job: Job<DockerOpRequest>): Promise<DockerOpResult> {
  try {
    return { ok: true, value: await run(job.data) };
  } catch (err) {
    if (err instanceof AppError) {
      return { ok: false, code: err.code, message: err.message, status: err.statusCode };
    }
    log.error('Docker operation failed', {
      op: job.data?.op,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
