'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { adminRequest } from '@/components/admin/admin-request';
import { formatBytes } from '@/lib/utils';
import type { CleanupResult } from '@/services/admin/admin-tools.service';

type Action = 'orphans' | 'images' | 'proxy-hits';
interface Orphan { name: string; slug: string; state: string }
interface Image { id: string; slug: string; sizeBytes: number; createdAt: string }
interface HitPreview { retentionDays: number; cutoff: string; count: number }

/** One cleanup: preview first, then a confirmed run of exactly what was previewed. */
function CleanupCard<T>({
  action, title, description, warning, describe, render, runBody,
}: {
  action: Action;
  title: string;
  description: string;
  warning: string;
  describe: (preview: T) => { count: number; summary: string };
  render: (preview: T) => React.ReactNode;
  runBody: (preview: T) => unknown;
}): React.ReactElement {
  const [preview, setPreview] = useState<T | null>(null);
  const [busy, setBusy] = useState<'preview' | 'run' | null>(null);
  const [results, setResults] = useState<CleanupResult[] | null>(null);

  const load = async (): Promise<void> => {
    setBusy('preview');
    setResults(null);
    try {
      setPreview(await adminRequest<T>(`/api/admin/maintenance/${action}`));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const run = async (): Promise<void> => {
    if (!preview) return;
    const { summary } = describe(preview);
    if (!confirm(`${summary}\n\n${warning}\n\nThis cannot be undone. Continue?`)) return;
    setBusy('run');
    try {
      const data = await adminRequest<CleanupResult[] | { deleted: number }>(`/api/admin/maintenance/${action}`, { method: 'POST', body: runBody(preview) });
      if (Array.isArray(data)) {
        setResults(data);
        const failed = data.filter((r) => !r.ok).length;
        if (failed) toast.error(`${failed} of ${data.length} failed`);
        else toast.success(`Done: ${data.length} cleaned up`);
      } else {
        toast.success(`Deleted ${data.deleted.toLocaleString()} rows`);
      }
      setPreview(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const count = preview ? describe(preview).count : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
        <CardDescription className="text-xs">{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {preview && (count === 0 ? <p className="text-xs text-muted-foreground">Nothing to clean up.</p> : render(preview))}
        {results && (
          <ul className="space-y-0.5 text-xs">
            {results.map((r) => (
              <li key={r.id} className={r.ok ? 'text-green-700 dark:text-green-400' : 'text-destructive'}>
                {r.id}: {r.ok ? 'removed' : r.error}
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => void load()}>
            {busy === 'preview' && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            {preview ? 'Refresh preview' : 'Preview'}
          </Button>
          <Button type="button" variant="destructive" size="sm" disabled={busy !== null || count === 0} onClick={() => void run()}>
            {busy === 'run' && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Clean up{count ? ` ${count.toLocaleString()}` : ''}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

const listClass = 'max-h-48 overflow-y-auto rounded-md bg-muted p-2 font-mono text-xs space-y-0.5';

export function MaintenancePanel(): React.ReactElement {
  return (
    <section className="space-y-3 max-w-2xl">
      <h2 className="text-base font-semibold">Maintenance</h2>
      <CleanupCard<Orphan[]>
        action="orphans"
        title="Orphaned containers"
        description="Containers built for a project that no longer exists, e.g. left behind by a deleted user. Only containers labelled as project containers and named exactly dropdeploy-<slug> are considered; platform containers never match."
        warning="Each one's container, images, persistent data volume and files are deleted."
        describe={(p) => ({ count: p.length, summary: `Remove ${p.length} orphaned project container(s): ${p.map((o) => o.slug).join(', ')}.` })}
        render={(p) => <ul className={listClass}>{p.map((o) => <li key={o.name}>{o.name} ({o.state})</li>)}</ul>}
        runBody={(p) => ({ slugs: p.map((o) => o.slug) })}
      />
      <CleanupCard<Image[]>
        action="images"
        title="Untagged images"
        description="Project images a rebuild left untagged. Rollback images keep their tag and are never listed; an image a container still uses is skipped."
        warning="The listed images are deleted from the Docker host."
        describe={(p) => ({
          count: p.length,
          summary: `Remove ${p.length} untagged image(s), ${formatBytes(p.reduce((n, i) => n + i.sizeBytes, 0))} in total.`,
        })}
        render={(p) => (
          <ul className={listClass}>
            {p.map((i) => <li key={i.id}>{i.slug} · {i.id.replace('sha256:', '').slice(0, 12)} · {formatBytes(i.sizeBytes)}</li>)}
          </ul>
        )}
        // One run per project prunes all its untagged images; the API caps the list at 500.
        runBody={(p) => ({ slugs: [...new Set(p.map((i) => i.slug))] })}
      />
      <CleanupCard<HitPreview>
        action="proxy-hits"
        title="Old proxy hits"
        description="Traffic rows older than the retention period set above. All-time traffic totals in Analytics and on project pages drop by the number deleted."
        warning="Analytics loses this history for good."
        describe={(p) => ({
          count: p.count,
          summary: `Delete ${p.count.toLocaleString()} proxy hits older than ${p.retentionDays} days (before ${new Date(p.cutoff).toLocaleDateString()}).`,
        })}
        render={(p) => (
          <p className="text-xs">
            {p.count.toLocaleString()} rows older than {p.retentionDays} days (before {new Date(p.cutoff).toLocaleString()}).
          </p>
        )}
        runBody={(p) => ({ retentionDays: p.retentionDays })}
      />
    </section>
  );
}
