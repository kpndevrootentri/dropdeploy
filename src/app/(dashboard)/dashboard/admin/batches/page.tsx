'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ChevronRight, Link2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { adminRequest } from '@/components/admin/admin-request';
import { JoiningPill, StagePill, batchStage, formatDay, isJoinable } from '@/components/admin/batch-status';

interface AdminCohort {
  id: string;
  name: string;
  program: string;
  startsAt: string;
  endsAt: string;
  joinCode: string;
  joinOpen: boolean;
  archivedAt: string | null;
  _count: { members: number; projects: number };
}

// YYYY-MM-DD in the admin's own time zone, the format a date input expects.
const today = (): string => new Date().toLocaleDateString('en-CA');
const emptyForm = (): { name: string; program: string; startsAt: string; endsAt: string } => ({ name: '', program: '', startsAt: today(), endsAt: '' });

export default function AdminBatchesPage(): React.ReactElement {
  const router = useRouter();
  const [cohorts, setCohorts] = useState<AdminCohort[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    adminRequest<{ cohorts: AdminCohort[]; enabled: boolean }>('/api/admin/cohorts')
      .then((d) => { setCohorts(d.cohorts); setEnabled(d.enabled); setError(null); })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(load, [load]);

  const openCreate = (): void => {
    setForm(emptyForm());
    setCreating(true);
  };

  const create = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setSaving(true);
    try {
      // The end date is inclusive: the batch runs until the end of that day.
      const created = await adminRequest<{ id: string }>('/api/admin/cohorts', { method: 'POST', body: { ...form, endsAt: `${form.endsAt}T23:59:59` } });
      toast.success(`Created ${form.name}`);
      setCreating(false);
      // Next steps (share the join link, add mentors) are on the batch's page.
      router.push(`/dashboard/admin/batches/${created.id}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const copyJoinLink = async (cohort: AdminCohort): Promise<void> => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/join/${cohort.joinCode}`);
      toast.success(`Join link for ${cohort.name} copied`);
    } catch {
      toast.error('Could not copy. Open the batch to see its join link.');
    }
  };

  if (error) return <p className="text-sm text-destructive" role="alert">{error}</p>;
  if (!cohorts) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Batches</h2>
          <p className="text-sm text-muted-foreground">Students join a batch with its link. Open a batch to add mentors and manage members.</p>
        </div>
        <Button onClick={openCreate}><Plus className="mr-1 h-4 w-4" aria-hidden />New batch</Button>
      </div>

      {!enabled && (
        <p role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          Batches are switched off: join links don&apos;t work and mentors have no access.{' '}
          <Link href="/dashboard/admin/settings" className="underline underline-offset-4">Turn them on in Settings</Link>.
        </p>
      )}

      {cohorts.length === 0 ? (
        <div className="rounded-lg border border-dashed px-6 py-12 text-center">
          <p className="font-medium">No batches yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Create one, then share its join link with the students.</p>
          <Button className="mt-4" onClick={openCreate}><Plus className="mr-1 h-4 w-4" aria-hidden />New batch</Button>
        </div>
      ) : (
        <div className="relative overflow-x-auto rounded-lg border">
          {/* relative: keeps the sr-only header label inside the scroll box, so phones get no page-wide scroll. */}
          <table className="w-full text-sm border-collapse">
            <caption className="sr-only">Batches</caption>
            <thead className="bg-muted/40">
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-4 py-2 font-medium">Batch</th>
                <th className="hidden px-4 py-2 font-medium md:table-cell">Dates</th>
                <th className="w-28 px-4 py-2 font-medium">Status</th>
                <th className="w-28 px-4 py-2 font-medium">Joining</th>
                <th className="w-24 px-4 py-2 text-right font-medium">Members</th>
                <th className="w-24 px-4 py-2 text-right font-medium">Projects</th>
                <th className="w-32 px-4 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {cohorts.map((c) => {
                const joinable = isJoinable(c);
                const href = `/dashboard/admin/batches/${c.id}`;
                return (
                  // The batch name is the keyboard-accessible link; the row click is a larger mouse target.
                  <tr key={c.id} onClick={() => router.push(href)} className="cursor-pointer border-b last:border-0 hover:bg-muted/40">
                    <td className="min-w-44 px-4 py-3">
                      <Link href={href} onClick={(e) => e.stopPropagation()} className="font-medium underline-offset-4 hover:underline">{c.name}</Link>
                      <div className="text-xs text-muted-foreground">{c.program}</div>
                    </td>
                    <td className="hidden whitespace-nowrap px-4 py-3 text-xs text-muted-foreground md:table-cell">{formatDay(c.startsAt)} – {formatDay(c.endsAt)}</td>
                    <td className="px-4 py-3"><StagePill stage={batchStage(c)} /></td>
                    <td className="px-4 py-3">
                      <JoiningPill open={joinable} />
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{c._count.members}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{c._count.projects}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!joinable}
                          title={joinable ? 'Copy the join link' : 'Joining is closed for this batch'}
                          onClick={(e) => { e.stopPropagation(); void copyJoinLink(c); }}
                        >
                          <Link2 className="mr-1 h-4 w-4" aria-hidden />Copy link
                        </Button>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New batch</DialogTitle>
            <DialogDescription>You&apos;ll get a join link to share with the students. Add mentors on the batch&apos;s page.</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => void create(e)} className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="batch-name">Name</Label>
              <Input id="batch-name" required minLength={3} maxLength={80} placeholder="FSD Jan 2027" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="batch-program">Course</Label>
              <Input id="batch-program" required maxLength={80} placeholder="Full Stack Development" value={form.program} onChange={(e) => setForm({ ...form, program: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="batch-start">Starts</Label>
              <Input id="batch-start" type="date" required value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="batch-end">Ends</Label>
              <Input id="batch-end" type="date" required min={form.startsAt || undefined} aria-describedby="batch-end-hint" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} />
              <p id="batch-end-hint" className="text-xs text-muted-foreground">Joining closes at the end of this day.</p>
            </div>
            <DialogFooter className="gap-2 sm:col-span-2">
              <Button type="button" variant="outline" onClick={() => setCreating(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create batch'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
