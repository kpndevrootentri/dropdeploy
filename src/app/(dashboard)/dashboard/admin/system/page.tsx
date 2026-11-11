'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import type { WorkerHeartbeat } from '@/lib/worker-health';
import type { DiskUsage } from '@/lib/disk-usage';
import { formatBytes } from '@/lib/utils';

const REFRESH_MS = 20_000;

interface StuckDeployment {
  id: string;
  status: string;
  buildStep: string | null;
  createdAt: string;
  startedAt: string | null;
  project: { id: string; name: string; slug: string; user: { email: string } };
}

interface SystemStatus {
  worker: WorkerHeartbeat;
  queue: Record<'waiting' | 'active' | 'delayed' | 'failed' | 'completed', number> | null;
  /** Null when the worker or Docker did not answer in time. */
  disk: DiskUsage | null;
  stuck: StuckDeployment[];
  stuckAfterMinutes: number;
}

function minutesSince(date: string): number {
  return Math.floor((Date.now() - new Date(date).getTime()) / 60_000);
}

export default function AdminSystemPage(): React.ReactElement {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);

  const load = useCallback(() => {
    fetch('/api/admin/system')
      .then((r) => r.json())
      .then((body) => {
        if (!body.success) throw new Error(body?.error?.message ?? body?.error ?? 'Failed to load system status');
        setStatus(body.data);
        setError(null);
        setCheckedAt(new Date());
      })
      .catch((err: Error) => setError(err.message || 'Failed to load system status'));
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  if (!status && !error) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const worker = status?.worker;
  const disk = status?.disk;
  const diskRows = disk && [
    { label: 'Images', size: disk.images.sizeBytes, detail: `${disk.images.count} images · ${formatBytes(disk.images.reclaimableBytes)} reclaimable` },
    { label: 'Containers', size: disk.containers.sizeBytes, detail: `${disk.containers.count} containers` },
    { label: 'Volumes', size: disk.volumes.sizeBytes, detail: `${disk.volumes.count} volumes` },
    { label: 'Build cache', size: disk.buildCache.sizeBytes, detail: `${formatBytes(disk.buildCache.reclaimableBytes)} reclaimable` },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">System</h2>
          <p className="text-sm text-muted-foreground">Refreshes every {REFRESH_MS / 1000} seconds.</p>
        </div>
        {checkedAt && (
          <p className="text-xs text-muted-foreground">Last checked {checkedAt.toLocaleTimeString()}</p>
        )}
      </div>

      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

      {status && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Deployment worker</CardTitle>
                <CardDescription className="text-xs">Builds, deploys and every Docker operation run here.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p className="flex items-center gap-2 font-medium">
                  <span className={`inline-block w-2 h-2 rounded-full ${worker?.alive ? 'bg-green-500' : 'bg-red-500'}`} />
                  {worker?.alive ? 'Running' : 'Not responding'}
                </p>
                {worker?.alive ? (
                  <p className="text-xs text-muted-foreground">
                    Heartbeat {worker.secondsAgo}s ago · pid {worker.pid} · up since {new Date(worker.startedAt).toLocaleString()}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No heartbeat in the last 90 seconds. Deploys, stops, restarts and container details will fail until it is back.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Deployment queue</CardTitle>
                <CardDescription className="text-xs">Jobs held in Redis by BullMQ.</CardDescription>
              </CardHeader>
              <CardContent>
                {status.queue ? (
                  <dl className="grid grid-cols-5 gap-2 text-center">
                    {(['waiting', 'active', 'delayed', 'failed', 'completed'] as const).map((k) => (
                      <div key={k} className="flex flex-col-reverse">
                        <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{k}</dt>
                        <dd className="text-xl font-bold tabular-nums">{status.queue![k]}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="text-xs text-destructive">Could not reach Redis to read the queue.</p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Docker disk usage</CardTitle>
              <CardDescription className="text-xs">Totals from docker system df. Reclaimable space is what a prune could free.</CardDescription>
            </CardHeader>
            <CardContent>
              {diskRows ? (
                <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  {diskRows.map(({ label, size, detail }) => (
                    <div key={label} className="flex flex-col gap-0.5">
                      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
                      <dd className="text-xl font-bold tabular-nums">{formatBytes(size)}</dd>
                      <dd className="text-xs text-muted-foreground">{detail}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-xs text-destructive">The worker did not report disk usage in time.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Stuck deployments</CardTitle>
              <CardDescription className="text-xs">
                Queued or building for more than {status.stuckAfterMinutes} minutes, the longest a build may run.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {status.stuck.length === 0 ? (
                <p className="text-xs text-muted-foreground">None.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground text-xs">
                        <th className="pb-2 pr-4">Project</th>
                        <th className="pb-2 pr-4">Owner</th>
                        <th className="pb-2 pr-4">Status</th>
                        <th className="pb-2 pr-4">Step</th>
                        <th className="pb-2">Stuck for</th>
                      </tr>
                    </thead>
                    <tbody>
                      {status.stuck.map((d) => (
                        <tr key={d.id} className="border-b">
                          <td className="py-2 pr-4 font-medium">{d.project.name}</td>
                          <td className="py-2 pr-4 text-xs text-muted-foreground">{d.project.user.email}</td>
                          <td className="py-2 pr-4 text-xs">{d.status}</td>
                          <td className="py-2 pr-4 text-xs text-muted-foreground">{d.buildStep ?? '—'}</td>
                          <td className="py-2 text-xs tabular-nums">{minutesSince(d.status === 'BUILDING' && d.startedAt ? d.startedAt : d.createdAt)} min</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
