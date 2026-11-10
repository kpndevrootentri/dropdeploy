'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { adminRequest } from '@/components/admin/admin-request';

interface ItemResult { id: string; ok: boolean; error?: string }

/** Summarises a bulk run; failures name the item so the admin can follow up. */
function report(results: ItemResult[], label: (id: string) => string, verb: string): void {
  const failed = results.filter((r) => !r.ok);
  if (failed.length === 0) {
    toast.success(`${verb} ${results.length}`);
    return;
  }
  toast.error(`${failed.length} of ${results.length} failed`, {
    description: failed.map((r) => `${label(r.id)}: ${r.error}`).join('\n'),
    duration: 15_000,
  });
}

function Bar({ count, onClear, children }: { count: number; onClear: () => void; children: React.ReactNode }): React.ReactElement | null {
  if (count === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
      <span className="font-medium">{count} selected</span>
      {children}
      <Button type="button" variant="ghost" size="sm" onClick={onClear}>Clear</Button>
    </div>
  );
}

type SetSelected = (next: Set<string>) => void;

export function SelectAllCheckbox({ ids, selected, onChange }: { ids: string[]; selected: Set<string>; onChange: SetSelected }): React.ReactElement {
  const all = ids.length > 0 && ids.every((id) => selected.has(id));
  return <input type="checkbox" aria-label="Select all" checked={all} onChange={() => onChange(all ? new Set() : new Set(ids))} />;
}

export function RowCheckbox({ id, label, selected, onChange }: { id: string; label: string; selected: Set<string>; onChange: SetSelected }): React.ReactElement {
  return (
    <input
      type="checkbox"
      aria-label={`Select ${label}`}
      checked={selected.has(id)}
      onChange={() => {
        const next = new Set(selected);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        onChange(next);
      }}
    />
  );
}

/** Only the items that failed stay selected, so the admin can retry or follow up on them. */
const failedIds = (results: ItemResult[]): Set<string> => new Set(results.filter((r) => !r.ok).map((r) => r.id));

const CONFIRM_WORD = 'DELETE';
/** The server's cap for a project bulk run (each item waits on the worker). */
const MAX_PROJECTS = 50;

export function ProjectBulkBar({
  selected,
  names,
  onChange,
  onDone,
}: {
  selected: string[];
  names: Map<string, string>;
  onChange: SetSelected;
  onDone: () => void;
}): React.ReactElement | null {
  const [busy, setBusy] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const label = (id: string): string => names.get(id) ?? id;
  const tooMany = selected.length > MAX_PROJECTS;
  const tooManyTitle = tooMany ? `At most ${MAX_PROJECTS} at a time` : undefined;

  const run = async (action: 'stop' | 'redeploy' | 'delete', verb: string): Promise<void> => {
    setBusy(action);
    try {
      const results = await adminRequest<ItemResult[]>(`/api/admin/projects/bulk/${action}`, {
        method: 'POST',
        body: { projectIds: selected, ...(action === 'delete' ? { confirm: typed } : {}) },
      });
      report(results, label, verb);
      setDeleteOpen(false);
      onChange(failedIds(results));
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Bar count={selected.length} onClear={() => onChange(new Set())}>
        <Button type="button" variant="outline" size="sm" disabled={busy !== null || tooMany} title={tooManyTitle}
          onClick={() => { if (confirm(`Stop ${selected.length} project container(s)?`)) void run('stop', 'Stopped'); }}>
          {busy === 'stop' && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Stop
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={busy !== null || tooMany} title={tooManyTitle}
          onClick={() => { if (confirm(`Rebuild and redeploy ${selected.length} project(s)? Builds queue one after another.`)) void run('redeploy', 'Queued'); }}>
          {busy === 'redeploy' && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Redeploy
        </Button>
        <Button type="button" variant="destructive" size="sm" disabled={busy !== null || tooMany} title={tooManyTitle}
          onClick={() => { setTyped(''); setDeleteOpen(true); }}>
          Delete
        </Button>
      </Bar>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {selected.length} project(s)?</DialogTitle>
            <DialogDescription>
              Each project, its container, images, data volume and every deployment are removed for good.
            </DialogDescription>
          </DialogHeader>
          <ul className="my-3 max-h-40 overflow-y-auto rounded-md bg-muted p-2 text-xs">
            {selected.map((id) => <li key={id}>{label(id)}</li>)}
          </ul>
          <div className="space-y-2">
            <Label htmlFor="bulk-delete-confirm">Type {CONFIRM_WORD} to confirm</Label>
            <Input id="bulk-delete-confirm" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
          </div>
          <DialogFooter className="pt-4">
            <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)} disabled={busy !== null}>Cancel</Button>
            <Button type="button" variant="destructive" disabled={typed !== CONFIRM_WORD || busy !== null} onClick={() => void run('delete', 'Deleted')}>
              {busy === 'delete' && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Delete {selected.length}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function UserBulkQuotaBar({
  selected,
  emails,
  onChange,
  onDone,
}: {
  selected: string[];
  emails: Map<string, string>;
  onChange: SetSelected;
  onDone: () => void;
}): React.ReactElement | null {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState('');
  const [domains, setDomains] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setSaving(true);
    try {
      const results = await adminRequest<ItemResult[]>('/api/admin/users/bulk-quota', {
        method: 'POST',
        body: {
          userIds: selected,
          ...(projects !== '' ? { projectQuota: Number(projects) } : {}),
          ...(domains !== '' ? { domainQuota: Number(domains) } : {}),
        },
      });
      report(results, (id) => emails.get(id) ?? id, 'Updated');
      setOpen(false);
      onChange(failedIds(results));
      onDone();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Bar count={selected.length} onClear={() => onChange(new Set())}>
        <Button type="button" variant="outline" size="sm" onClick={() => { setProjects(''); setDomains(''); setOpen(true); }}>
          Set quota
        </Button>
      </Bar>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Set quotas for {selected.length} user(s)</DialogTitle>
            <DialogDescription>Leave a field empty to keep each user&apos;s current value.</DialogDescription>
          </DialogHeader>
          <form id="bulk-quota-form" onSubmit={save} className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="bulk-project-quota">Max projects</Label>
              <Input id="bulk-project-quota" type="number" min={0} step={1} value={projects} onChange={(e) => setProjects(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bulk-domain-quota">Max custom domains</Label>
              <Input id="bulk-domain-quota" type="number" min={0} step={1} value={domains} onChange={(e) => setDomains(e.target.value)} />
            </div>
          </form>
          <DialogFooter className="pt-4">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" form="bulk-quota-form" disabled={saving || (projects === '' && domains === '')}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
