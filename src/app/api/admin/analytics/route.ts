import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { prisma } from '@/lib/prisma';
import { handleApiError } from '@/lib/api-error';

/** The only ranges offered; anything else is rejected rather than run as an unbounded scan. */
const rangeSchema = z.enum(['7', '14', '30', '90']).default('14').transform(Number);

function bucketByDay(
  now: Date,
  dates: Date[],
  days: number,
): { date: string; count: number }[] {
  const map = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    map.set(d.toISOString().slice(0, 10), 0);
  }
  for (const d of dates) {
    const key = d.toISOString().slice(0, 10);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return Array.from(map.entries()).map(([date, count]) => ({ date, count }));
}

/**
 * GET /api/admin/analytics?days=7|14|30|90
 * Platform-wide analytics for the admin panel. Contributor-only.
 * The per-day series and the range-only stats cover `days` (default 14); totals stay all-time.
 */
export async function GET(req: NextRequest): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);

    const days = rangeSchema.parse(req.nextUrl.searchParams.get('days') ?? undefined);
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      newUsersThisWeek,
      recentUsers,
      totalProjects,
      newProjectsThisWeek,
      projectsByType,
      recentProjects,
      totalDeployments,
      succeededDeployments,
      failedDeployments,
      deploysThisWeek,
      recentDeployments,
      totalHits,
      hitsThisWeek,
      recentHits,
      deviceRows,
      showcaseAggregate,
      showcasePublished,
      topShowcases,
      eventsByType,
      eventsThisWeek,
      hitsByProject,
      buildTimeRows,
      failuresByStep,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
      prisma.user.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
      prisma.project.count(),
      prisma.project.count({ where: { createdAt: { gte: weekAgo } } }),
      prisma.project.groupBy({ by: ['type'], _count: { id: true }, orderBy: { _count: { id: 'desc' } } }),
      prisma.project.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
      prisma.deployment.count(),
      prisma.deployment.count({ where: { status: 'DEPLOYED' } }),
      prisma.deployment.count({ where: { status: 'FAILED' } }),
      prisma.deployment.count({ where: { createdAt: { gte: weekAgo } } }),
      prisma.deployment.findMany({
        where: { createdAt: { gte: since } },
        select: { createdAt: true, status: true },
      }),
      prisma.proxyHit.count(),
      prisma.proxyHit.count({ where: { createdAt: { gte: weekAgo } } }),
      // Grouped in SQL: hits grow with tenant traffic, so loading each row would not scale.
      // created_at is a UTC timestamp without time zone, so to_char yields the UTC day.
      prisma.$queryRaw<{ date: string; count: number }[]>`
        SELECT to_char(created_at, 'YYYY-MM-DD') AS date, COUNT(*)::int AS count
        FROM proxy_hits WHERE created_at >= ${since} GROUP BY 1`,
      prisma.proxyHit.groupBy({ by: ['device'], _count: { id: true } }),
      prisma.projectShowcase.aggregate({ _count: { _all: true }, _sum: { viewCount: true } }),
      prisma.projectShowcase.count({ where: { isPublished: true } }),
      prisma.projectShowcase.findMany({
        where: { isPublished: true },
        orderBy: { viewCount: 'desc' },
        take: 5,
        select: { viewCount: true, project: { select: { name: true, slug: true } } },
      }),
      prisma.platformEvent.groupBy({
        by: ['event'],
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
      }),
      prisma.platformEvent.count({ where: { createdAt: { gte: weekAgo } } }),
      prisma.proxyHit.groupBy({
        by: ['projectId'],
        where: { createdAt: { gte: since } },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10,
      }),
      // Real builds only: rollbacks reuse an image and uploads have no build, so both would drag the times down.
      prisma.$queryRaw<{ p50: number | null; p95: number | null; count: number }[]>`
        SELECT
          percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (d.completed_at - d.started_at))::float8) AS p50,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (d.completed_at - d.started_at))::float8) AS p95,
          COUNT(*)::int AS count
        FROM deployments d JOIN projects p ON p.id = d.project_id
        WHERE d.status = 'DEPLOYED' AND d.started_at IS NOT NULL AND d.completed_at IS NOT NULL
          AND d.rollback_of_id IS NULL AND p.source <> 'UPLOAD' AND d.created_at >= ${since}`,
      // There is no error-message column; the step a build stopped at is the best grouping we have.
      prisma.deployment.groupBy({
        by: ['buildStep'],
        where: { status: 'FAILED', createdAt: { gte: since } },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
      }),
    ]);

    const topProjectRows = await prisma.project.findMany({
      where: { id: { in: hitsByProject.map((h) => h.projectId) } },
      select: { id: true, name: true, slug: true },
    });
    const topProjects = hitsByProject.map((h) => {
      const project = topProjectRows.find((p) => p.id === h.projectId);
      return { name: project?.name ?? '(deleted)', slug: project?.slug ?? '', hits: h._count?.id ?? 0 };
    });
    const buildTimes = buildTimeRows[0] ?? { p50: null, p95: null, count: 0 };

    // Deployment frequency by day
    const deployDayMap = new Map<string, { total: number; succeeded: number; failed: number }>();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      deployDayMap.set(d.toISOString().slice(0, 10), { total: 0, succeeded: 0, failed: 0 });
    }
    for (const { createdAt, status } of recentDeployments) {
      const key = createdAt.toISOString().slice(0, 10);
      const bucket = deployDayMap.get(key);
      if (bucket) {
        bucket.total++;
        if (status === 'DEPLOYED') bucket.succeeded++;
        if (status === 'FAILED') bucket.failed++;
      }
    }

    const terminalCount = succeededDeployments + failedDeployments;

    const deviceBreakdown = { mobile: 0, desktop: 0, bot: 0, unknown: 0 };
    for (const row of deviceRows) {
      const key = (row.device ?? 'unknown') as keyof typeof deviceBreakdown;
      const n = row._count?.id ?? 0;
      if (key in deviceBreakdown) deviceBreakdown[key] += n;
      else deviceBreakdown.unknown += n;
    }

    return NextResponse.json({
      success: true,
      data: {
        range: days,
        users: {
          total: totalUsers,
          thisWeek: newUsersThisWeek,
          byDay: bucketByDay(now, recentUsers.map((u) => u.createdAt), days),
        },
        projects: {
          total: totalProjects,
          thisWeek: newProjectsThisWeek,
          byType: projectsByType.map((r) => ({ type: r.type, count: r._count?.id ?? 0 })),
          byDay: bucketByDay(now, recentProjects.map((p) => p.createdAt), days),
        },
        deployments: {
          total: totalDeployments,
          succeeded: succeededDeployments,
          failed: failedDeployments,
          thisWeek: deploysThisWeek,
          successRate: terminalCount > 0 ? succeededDeployments / terminalCount : null,
          byDay: Array.from(deployDayMap.entries()).map(([date, counts]) => ({ date, ...counts })),
          buildTimes: { p50Seconds: buildTimes.p50, p95Seconds: buildTimes.p95, count: buildTimes.count },
          failuresByStep: failuresByStep.map((r) => ({ step: r.buildStep, count: r._count?.id ?? 0 })),
        },
        traffic: {
          totalHits,
          hitsThisWeek,
          byDay: bucketByDay(now, [], days).map((d) => ({
            ...d,
            count: recentHits.find((h) => h.date === d.date)?.count ?? 0,
          })),
          deviceBreakdown,
          topProjects,
        },
        showcase: {
          total: showcaseAggregate._count._all,
          published: showcasePublished,
          totalViews: showcaseAggregate._sum.viewCount ?? 0,
          topByViews: topShowcases.map((s) => ({
            name: s.project.name,
            slug: s.project.slug,
            viewCount: s.viewCount,
          })),
        },
        platformEvents: {
          byEvent: eventsByType.map((r) => ({ event: r.event, count: r._count?.id ?? 0 })),
          thisWeek: eventsThisWeek,
        },
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
