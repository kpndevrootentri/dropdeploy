import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { prisma } from '@/lib/prisma';
import { getDeploymentQueue } from '@/lib/queue';
import { getWorkerHeartbeat } from '@/lib/worker-health';
import { withRedisTimeout } from '@/lib/redis';
import { dockerOps } from '@/lib/docker-ops';
import { getConfig } from '@/lib/config';
import { handleApiError } from '@/lib/api-error';
import { createLogger } from '@/lib/logger';

const log = createLogger('admin-system');

/**
 * GET /api/admin/system
 * Worker heartbeat, deployment queue counts, Docker disk usage and deployments
 * that have sat in QUEUED or BUILDING for longer than a build is allowed to
 * take. Contributor-only.
 */
export async function GET(req: NextRequest): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);

    // A build that outlives the job timeout has been abandoned, so anything older is stuck.
    const stuckAfterMs = getConfig().BULLMQ_JOB_TIMEOUT_MS;
    const cutoff = new Date(Date.now() - stuckAfterMs);

    const [worker, queue, disk, stuck] = await Promise.all([
      getWorkerHeartbeat(),
      withRedisTimeout(getDeploymentQueue().getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed'))
        .catch((err: unknown) => {
          log.warn('Could not read deployment queue counts', { error: String(err) });
          return null;
        }),
      // Goes through Redis to the worker, then the Docker daemon: either can stall.
      withRedisTimeout(dockerOps.diskUsage(), 5_000)
        .catch((err: unknown) => {
          log.warn('Could not read Docker disk usage', { error: String(err) });
          return null;
        }),
      prisma.deployment.findMany({
        // The build timeout runs from build start, so time spent waiting in the queue does not count against a build.
        where: {
          OR: [
            { status: 'BUILDING', startedAt: { lt: cutoff } },
            { status: 'QUEUED', createdAt: { lt: cutoff } },
          ],
        },
        orderBy: { createdAt: 'asc' },
        take: 50,
        select: {
          id: true,
          status: true,
          buildStep: true,
          createdAt: true,
          startedAt: true,
          project: { select: { id: true, name: true, slug: true, user: { select: { email: true } } } },
        },
      }),
    ]);

    return NextResponse.json({
      success: true,
      data: { worker, queue, disk, stuck, stuckAfterMinutes: Math.round(stuckAfterMs / 60_000) },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
