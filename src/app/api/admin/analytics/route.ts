import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { prisma } from '@/lib/prisma';
import { handleApiError } from '@/lib/api-error';

function bucketByDay(
  now: Date,
  dates: Date[],
): { date: string; count: number }[] {
  const map = new Map<string, number>();
  for (let i = 13; i >= 0; i--) {
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
 * GET /api/admin/analytics
 * Platform-wide analytics for the admin panel. Contributor-only.
 */
export async function GET(req: NextRequest): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

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
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
      prisma.user.findMany({ where: { createdAt: { gte: fourteenDaysAgo } }, select: { createdAt: true } }),
      prisma.project.count(),
      prisma.project.count({ where: { createdAt: { gte: weekAgo } } }),
      prisma.project.groupBy({ by: ['type'], _count: { id: true }, orderBy: { _count: { id: 'desc' } } }),
      prisma.project.findMany({ where: { createdAt: { gte: fourteenDaysAgo } }, select: { createdAt: true } }),
      prisma.deployment.count(),
      prisma.deployment.count({ where: { status: 'DEPLOYED' } }),
      prisma.deployment.count({ where: { status: 'FAILED' } }),
      prisma.deployment.count({ where: { createdAt: { gte: weekAgo } } }),
      prisma.deployment.findMany({
        where: { createdAt: { gte: fourteenDaysAgo } },
        select: { createdAt: true, status: true },
      }),
      prisma.proxyHit.count(),
      prisma.proxyHit.count({ where: { createdAt: { gte: weekAgo } } }),
      prisma.proxyHit.findMany({ where: { createdAt: { gte: fourteenDaysAgo } }, select: { createdAt: true } }),
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
    ]);

    // Deployment frequency by day
    const deployDayMap = new Map<string, { total: number; succeeded: number; failed: number }>();
    for (let i = 13; i >= 0; i--) {
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
        users: {
          total: totalUsers,
          thisWeek: newUsersThisWeek,
          byDay: bucketByDay(now, recentUsers.map((u) => u.createdAt)),
        },
        projects: {
          total: totalProjects,
          thisWeek: newProjectsThisWeek,
          byType: projectsByType.map((r) => ({ type: r.type, count: r._count?.id ?? 0 })),
          byDay: bucketByDay(now, recentProjects.map((p) => p.createdAt)),
        },
        deployments: {
          total: totalDeployments,
          succeeded: succeededDeployments,
          failed: failedDeployments,
          thisWeek: deploysThisWeek,
          successRate: terminalCount > 0 ? succeededDeployments / terminalCount : null,
          byDay: Array.from(deployDayMap.entries()).map(([date, counts]) => ({ date, ...counts })),
        },
        traffic: {
          totalHits,
          hitsThisWeek,
          byDay: bucketByDay(now, recentHits.map((h) => h.createdAt)),
          deviceBreakdown,
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
