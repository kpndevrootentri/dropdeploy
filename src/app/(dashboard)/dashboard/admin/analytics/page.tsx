'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Users, FolderGit2, Rocket, Wifi, TrendingUp, Activity,
  BarChart2, Eye, Loader2, ExternalLink,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DayCount { date: string; count: number }
interface DeployDay { date: string; total: number; succeeded: number; failed: number }
interface DeviceBreakdown { mobile: number; desktop: number; bot: number; unknown: number }

interface AdminAnalytics {
  users: { total: number; thisWeek: number; byDay: DayCount[] };
  projects: { total: number; thisWeek: number; byType: { type: string; count: number }[]; byDay: DayCount[] };
  deployments: {
    total: number; succeeded: number; failed: number;
    thisWeek: number; successRate: number | null; byDay: DeployDay[];
  };
  traffic: { totalHits: number; hitsThisWeek: number; byDay: DayCount[]; deviceBreakdown: DeviceBreakdown };
  showcase: { total: number; published: number; totalViews: number; topByViews: { name: string; slug: string; viewCount: number }[] };
  platformEvents: { byEvent: { event: string; count: number }[]; thisWeek: number };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ---------------------------------------------------------------------------
// Chart: simple bar (single colour)
// ---------------------------------------------------------------------------

function SimpleBarChart({ days, color = 'bg-blue-500' }: { days: DayCount[]; color?: string }): React.ReactElement {
  const max = Math.max(...days.map((d) => d.count), 1);
  return (
    <div>
      <div className="flex items-end gap-px sm:gap-0.5 h-16">
        {days.map((day) => {
          const h = day.count > 0 ? Math.max((day.count / max) * 100, 8) : 0;
          return (
            <div key={day.date} className="flex-1 relative group flex flex-col justify-end h-full">
              {day.count > 0 ? (
                <div className={`w-full rounded-t-sm ${color} transition-opacity group-hover:opacity-70`} style={{ height: `${h}%` }} />
              ) : (
                <div className="w-full bg-border rounded-sm" style={{ height: '2px' }} />
              )}
              {day.count > 0 && (
                <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col items-center z-10 bg-popover border rounded px-2 py-1 text-xs whitespace-nowrap shadow pointer-events-none">
                  <span className="font-medium">{formatShortDate(day.date)}</span>
                  <span>{day.count}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex gap-px sm:gap-0.5 mt-0.5">
        {days.map((day, i) => (
          <div key={day.date} className="flex-1 text-center">
            {(i === 0 || i === 6 || i === 13) && (
              <span className="text-[10px] text-muted-foreground">{formatShortDate(day.date)}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chart: deploy frequency (green/red/yellow)
// ---------------------------------------------------------------------------

function DeployBarChart({ days }: { days: DeployDay[] }): React.ReactElement {
  const max = Math.max(...days.map((d) => d.total), 1);
  return (
    <div>
      <div className="flex items-end gap-px sm:gap-0.5 h-16">
        {days.map((day) => {
          const h = day.total > 0 ? Math.max((day.total / max) * 100, 8) : 0;
          const color =
            day.total === 0 ? ''
            : day.failed === 0 ? 'bg-green-500'
            : day.succeeded === 0 ? 'bg-destructive'
            : 'bg-yellow-500';
          return (
            <div key={day.date} className="flex-1 relative group flex flex-col justify-end h-full">
              {day.total > 0 ? (
                <div className={`w-full rounded-t-sm ${color} transition-opacity group-hover:opacity-70`} style={{ height: `${h}%` }} />
              ) : (
                <div className="w-full bg-border rounded-sm" style={{ height: '2px' }} />
              )}
              {day.total > 0 && (
                <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col items-center z-10 bg-popover border rounded px-2 py-1 text-xs whitespace-nowrap shadow pointer-events-none">
                  <span className="font-medium">{formatShortDate(day.date)}</span>
                  <span>{day.total} deploys</span>
                  {day.succeeded > 0 && <span className="text-green-600">{day.succeeded} ok</span>}
                  {day.failed > 0 && <span className="text-destructive">{day.failed} failed</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex gap-px sm:gap-0.5 mt-0.5">
        {days.map((day, i) => (
          <div key={day.date} className="flex-1 text-center">
            {(i === 0 || i === 6 || i === 13) && (
              <span className="text-[10px] text-muted-foreground">{formatShortDate(day.date)}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

function StatCard({
  label, value, sub, icon, accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  accent?: string;
}): React.ReactElement {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className={`flex items-center gap-2 mb-2 ${accent ?? 'text-muted-foreground'}`}>
          {icon}
          <p className="text-xs uppercase tracking-wide">{label}</p>
        </div>
        <p className="text-2xl font-bold tabular-nums">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Horizontal bar (for framework / device breakdown)
// ---------------------------------------------------------------------------

function HorizBar({ label, count, max, color = 'bg-primary' }: { label: string; count: number; max: number; color?: string }): React.ReactElement {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-muted-foreground w-20 shrink-0 truncate">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground w-10 text-right">{count.toLocaleString()}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AdminAnalyticsPage(): React.ReactElement {
  const [data, setData] = useState<AdminAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/analytics')
      .then((r) => r.json())
      .then((res: { success: boolean; data?: AdminAnalytics; error?: { message: string } }) => {
        if (res.success && res.data) setData(res.data);
        else setError(res.error?.message ?? 'Failed to load');
      })
      .catch(() => setError('Failed to load analytics'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Analytics</CardTitle>
          <CardDescription className="text-destructive">{error ?? 'No data'}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const successPct = data.deployments.successRate !== null
    ? `${Math.round(data.deployments.successRate * 100)}%`
    : '—';

  const maxFrameworkCount = Math.max(...data.projects.byType.map((t) => t.count), 1);
  const maxDevice = Math.max(...Object.values(data.traffic.deviceBreakdown), 1);

  const deviceLabels: Record<keyof DeviceBreakdown, string> = {
    desktop: 'Desktop',
    mobile: 'Mobile',
    bot: 'Bot / Crawler',
    unknown: 'Unknown',
  };

  return (
    <div className="space-y-8">

      {/* ── Summary stat cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Total users"
          value={data.users.total.toLocaleString()}
          sub={`+${data.users.thisWeek} this week`}
          icon={<Users className="h-3.5 w-3.5" />}
        />
        <StatCard
          label="Total projects"
          value={data.projects.total.toLocaleString()}
          sub={`+${data.projects.thisWeek} this week`}
          icon={<FolderGit2 className="h-3.5 w-3.5" />}
        />
        <StatCard
          label="Total deploys"
          value={data.deployments.total.toLocaleString()}
          sub={`${successPct} success rate`}
          icon={<Rocket className="h-3.5 w-3.5" />}
        />
        <StatCard
          label="Proxy traffic"
          value={data.traffic.totalHits.toLocaleString()}
          sub={`+${data.traffic.hitsThisWeek} this week`}
          icon={<Wifi className="h-3.5 w-3.5" />}
        />
      </div>

      {/* ── Deploy + Traffic charts side by side ── */}
      <div className="grid sm:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Deploy frequency</CardTitle>
              <span className="text-xs text-muted-foreground">{data.deployments.thisWeek} this week</span>
            </div>
            <CardDescription className="text-xs">Deployments per day — last 14 days</CardDescription>
          </CardHeader>
          <CardContent>
            <DeployBarChart days={data.deployments.byDay} />
            <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-green-500" />All ok</span>
              <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-yellow-500" />Mixed</span>
              <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-destructive" />All failed</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Proxy traffic</CardTitle>
              <span className="text-xs text-muted-foreground">{data.traffic.hitsThisWeek} this week</span>
            </div>
            <CardDescription className="text-xs">Requests via subdomain proxy — last 14 days</CardDescription>
          </CardHeader>
          <CardContent>
            <SimpleBarChart days={data.traffic.byDay} color="bg-blue-500" />
          </CardContent>
        </Card>
      </div>

      {/* ── New users + New projects charts ── */}
      <div className="grid sm:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">New signups</CardTitle>
              <span className="text-xs text-muted-foreground">+{data.users.thisWeek} this week</span>
            </div>
            <CardDescription className="text-xs">User registrations — last 14 days</CardDescription>
          </CardHeader>
          <CardContent>
            <SimpleBarChart days={data.users.byDay} color="bg-violet-500" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">New projects</CardTitle>
              <span className="text-xs text-muted-foreground">+{data.projects.thisWeek} this week</span>
            </div>
            <CardDescription className="text-xs">Projects created — last 14 days</CardDescription>
          </CardHeader>
          <CardContent>
            <SimpleBarChart days={data.projects.byDay} color="bg-orange-500" />
          </CardContent>
        </Card>
      </div>

      {/* ── Deployment health ── */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard
          label="Succeeded"
          value={data.deployments.succeeded.toLocaleString()}
          icon={<TrendingUp className="h-3.5 w-3.5" />}
          accent="text-green-600"
        />
        <StatCard
          label="Failed"
          value={data.deployments.failed.toLocaleString()}
          icon={<Activity className="h-3.5 w-3.5" />}
          accent="text-destructive"
        />
        <StatCard
          label="Success rate"
          value={successPct}
          icon={<BarChart2 className="h-3.5 w-3.5" />}
        />
      </div>

      {/* ── Framework distribution + Device breakdown ── */}
      <div className="grid sm:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Framework distribution</CardTitle>
            <CardDescription className="text-xs">Projects by type across all users</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.projects.byType.length === 0 ? (
              <p className="text-xs text-muted-foreground">No projects yet.</p>
            ) : (
              data.projects.byType.map(({ type, count }) => (
                <HorizBar key={type} label={type} count={count} max={maxFrameworkCount} color="bg-primary" />
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Traffic by device</CardTitle>
            <CardDescription className="text-xs">All-time proxy requests by device type</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.traffic.totalHits === 0 ? (
              <p className="text-xs text-muted-foreground">No traffic recorded yet.</p>
            ) : (
              (Object.entries(data.traffic.deviceBreakdown) as [keyof DeviceBreakdown, number][])
                .filter(([, count]) => count > 0)
                .sort(([, a], [, b]) => b - a)
                .map(([key, count]) => (
                  <HorizBar key={key} label={deviceLabels[key]} count={count} max={maxDevice} color="bg-blue-500" />
                ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Showcase stats + Top tools ── */}
      <div className="grid sm:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Showcase</CardTitle>
            <CardDescription className="text-xs">Public Explore page stats</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-2xl font-bold tabular-nums">{data.showcase.total}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Total</p>
              </div>
              <div>
                <p className="text-2xl font-bold tabular-nums">{data.showcase.published}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Published</p>
              </div>
              <div>
                <p className="text-2xl font-bold tabular-nums">{data.showcase.totalViews.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Total views</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Top tools by views</CardTitle>
            <CardDescription className="text-xs">Most visited showcase entries</CardDescription>
          </CardHeader>
          <CardContent>
            {data.showcase.topByViews.length === 0 ? (
              <p className="text-xs text-muted-foreground">No published tools yet.</p>
            ) : (
              <div className="space-y-2">
                {data.showcase.topByViews.map((tool, i) => (
                  <div key={tool.slug} className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-4 tabular-nums shrink-0">{i + 1}.</span>
                    <span className="text-xs font-medium flex-1 truncate">{tool.name}</span>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                      <Eye className="h-3 w-3" />
                      {tool.viewCount.toLocaleString()}
                    </span>
                    <Link
                      href={`/explore/${tool.slug}`}
                      target="_blank"
                      className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Platform events ── */}
      {data.platformEvents.byEvent.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Platform events</CardTitle>
              <span className="text-xs text-muted-foreground">{data.platformEvents.thisWeek} this week</span>
            </div>
            <CardDescription className="text-xs">All-time funnel event counts</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="divide-y">
              {data.platformEvents.byEvent.map(({ event, count }) => (
                <div key={event} className="flex items-center justify-between py-2">
                  <code className="text-xs font-mono text-foreground">{event}</code>
                  <span className="text-xs tabular-nums text-muted-foreground">{count.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

    </div>
  );
}
