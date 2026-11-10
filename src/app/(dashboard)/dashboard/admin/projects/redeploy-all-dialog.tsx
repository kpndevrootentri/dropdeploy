'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const CONFIRMATION = 'redeploy all';
const TYPES = ['STATIC', 'NODEJS', 'NEXTJS', 'DJANGO', 'REACT', 'FASTAPI', 'FLASK', 'VUE', 'SVELTE', 'GO', 'RUST', 'JAVA', 'WORDPRESS'];
const SOURCES = ['GITHUB', 'GITLAB', 'UPLOAD'];

interface Plan {
  concurrency: number;
  eligible: { id: string; name: string; ownerEmail: string; type: string; source: string }[];
  skipped: { id: string; name: string; reason: string }[];
  results?: { id: string; name: string; outcome: 'queued' | 'failed'; error?: string }[];
}

const selectClass = 'h-9 w-full rounded-md border bg-background px-2 text-sm';

export function RedeployAllDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}): React.ReactElement {
  const [type, setType] = useState('');
  const [source, setSource] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = (): void => {
    setPlan(null);
    setConfirm('');
    setError(null);
  };

  const run = async (dryRun: boolean): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/projects/redeploy-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: type || undefined,
          source: source || undefined,
          dryRun,
          confirm: dryRun ? undefined : confirm,
          // Only what the preview showed; a project that appeared since is left for the next run.
          projectIds: dryRun ? undefined : plan?.eligible.map((p) => p.id),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error?.message ?? body?.error ?? 'Request failed');
        return;
      }
      setPlan(body.data);
      if (!dryRun) onDone();
    } catch {
      setError('Network error');
    } finally {
      setBusy(false);
    }
  };

  const done = plan?.results !== undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Redeploy all</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {!done && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="redeploy-type">Type</Label>
                <select id="redeploy-type" className={selectClass} value={type} onChange={(e) => { setType(e.target.value); reset(); }}>
                  <option value="">All types</option>
                  {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="redeploy-source">Source</Label>
                <select id="redeploy-source" className={selectClass} value={source} onChange={(e) => { setSource(e.target.value); reset(); }}>
                  <option value="">All sources</option>
                  {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
          )}

          {plan && !done && (
            <>
              <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                Every build runs on the host that serves all sites. The worker builds up to{' '}
                <strong>{plan.concurrency}</strong> at a time (BULLMQ_CONCURRENCY); the rest wait in the queue.
              </p>
              <div className="space-y-1">
                <p className="font-medium">Will redeploy ({plan.eligible.length})</p>
                <ul className="max-h-40 overflow-y-auto rounded-md bg-muted p-2 text-xs space-y-0.5">
                  {plan.eligible.length === 0 && <li className="text-muted-foreground">Nothing to redeploy.</li>}
                  {plan.eligible.map((p) => (
                    <li key={p.id}>
                      <span className="font-medium">{p.name}</span>{' '}
                      <span className="text-muted-foreground">· {p.type} · {p.ownerEmail}</span>
                    </li>
                  ))}
                </ul>
              </div>
              {plan.skipped.length > 0 && (
                <div className="space-y-1">
                  <p className="font-medium">Skipped ({plan.skipped.length})</p>
                  <ul className="max-h-32 overflow-y-auto rounded-md bg-muted p-2 text-xs space-y-0.5">
                    {plan.skipped.map((p) => (
                      <li key={p.id}>
                        <span className="font-medium">{p.name}</span>{' '}
                        <span className="text-muted-foreground">— {p.reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {plan.eligible.length > 0 && (
                <div className="space-y-1">
                  <Label htmlFor="redeploy-confirm">
                    Type <code className="font-mono">{CONFIRMATION}</code> to confirm
                  </Label>
                  <Input
                    id="redeploy-confirm"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    autoComplete="off"
                  />
                </div>
              )}
            </>
          )}

          {done && plan?.results && (
            <div className="space-y-1">
              <p>
                <span className="font-semibold">{plan.results.filter((r) => r.outcome === 'queued').length}</span> queued ·{' '}
                <span className="font-semibold">{plan.results.filter((r) => r.outcome === 'failed').length}</span> failed ·{' '}
                <span className="font-semibold">{plan.skipped.length}</span> skipped
              </p>
              <ul className="max-h-56 overflow-y-auto rounded-md bg-muted p-2 text-xs space-y-0.5">
                {plan.results.map((r) => (
                  <li key={r.id}>
                    <span className="font-medium">{r.name}</span>{' '}
                    {r.outcome === 'queued'
                      ? <span className="text-green-700 dark:text-green-400">queued</span>
                      : <span className="text-destructive">failed — {r.error}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>

        <DialogFooter>
          {done ? (
            <Button onClick={() => { reset(); onOpenChange(false); }}>Done</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => { reset(); onOpenChange(false); }} disabled={busy}>
                Cancel
              </Button>
              {plan ? (
                <Button
                  variant="destructive"
                  disabled={busy || plan.eligible.length === 0 || confirm !== CONFIRMATION}
                  onClick={() => void run(false)}
                >
                  {busy ? 'Queuing…' : `Redeploy ${plan.eligible.length} project${plan.eligible.length === 1 ? '' : 's'}`}
                </Button>
              ) : (
                <Button onClick={() => void run(true)} disabled={busy}>
                  {busy ? 'Checking…' : 'Preview'}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
