import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { projectService } from '@/services/project';
import { prisma } from '@/lib/prisma';
import { handleApiError } from '@/lib/api-error';

/**
 * GET /api/projects/:id/analytics
 * Returns aggregated deployment stats for the project.
 * No auth except ownership — no sensitive data exposed.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const { id } = await params;
    await projectService.getById(id, session.userId);

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [total, deployedCount, failedCount, latestDeployed, recentDeployments] =
      await Promise.all([
        prisma.deployment.count({ where: { projectId: id } }),
        prisma.deployment.count({ where: { projectId: id, status: 'DEPLOYED' } }),
        prisma.deployment.count({ where: { projectId: id, status: 'FAILED' } }),
        prisma.deployment.findFirst({
          where: { projectId: id, status: 'DEPLOYED' },
          orderBy: { completedAt: 'desc' },
          select: { completedAt: true },
        }),
        prisma.deployment.findMany({
          where: { projectId: id, createdAt: { gte: thirtyDaysAgo } },
          select: { status: true, createdAt: true, startedAt: true, completedAt: true },
          orderBy: { createdAt: 'asc' },
        }),
      ]);

    const terminalCount = deployedCount + failedCount;
    const successRate = terminalCount > 0 ? deployedCount / terminalCount : null;
    const deploysThisWeek = recentDeployments.filter((d) => d.createdAt >= weekAgo).length;

    // Average build time for successful builds in last 30 days
    const finishedBuilds = recentDeployments.filter(
      (d) => d.status === 'DEPLOYED' && d.startedAt && d.completedAt
    );
    const avgBuildMs =
      finishedBuilds.length > 0
        ? finishedBuilds.reduce(
            (acc, d) => acc + (d.completedAt!.getTime() - d.startedAt!.getTime()),
            0
          ) / finishedBuilds.length
        : null;

    // How long the project has been live (since last successful deploy completed)
    const liveSinceMs =
      latestDeployed?.completedAt != null
        ? now.getTime() - latestDeployed.completedAt.getTime()
        : null;

    // Deploy frequency: slot last 14 calendar days into buckets
    const dayMap = new Map<string, { total: number; succeeded: number; failed: number }>();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      dayMap.set(d.toISOString().slice(0, 10), { total: 0, succeeded: 0, failed: 0 });
    }
    for (const d of recentDeployments) {
      const key = d.createdAt.toISOString().slice(0, 10);
      const bucket = dayMap.get(key);
      if (bucket) {
        bucket.total++;
        if (d.status === 'DEPLOYED') bucket.succeeded++;
        if (d.status === 'FAILED') bucket.failed++;
      }
    }
    const deploysByDay = Array.from(dayMap.entries()).map(([date, counts]) => ({
      date,
      ...counts,
    }));

    // Last 15 terminal builds (oldest→newest) for trend chart
    const recentBuildTimes = recentDeployments
      .filter(
        (d) =>
          (d.status === 'DEPLOYED' || d.status === 'FAILED') && d.startedAt && d.completedAt
      )
      .slice(-15)
      .map((d) => ({
        createdAt: d.createdAt.toISOString(),
        durationMs: d.completedAt!.getTime() - d.startedAt!.getTime(),
        status: d.status,
      }));

    return NextResponse.json({
      success: true,
      data: {
        totalDeployments: total,
        deploysThisWeek,
        successRate,
        avgBuildMs,
        liveSinceMs,
        deploysByDay,
        recentBuildTimes,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
