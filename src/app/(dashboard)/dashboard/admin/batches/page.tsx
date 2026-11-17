'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { adminRequest } from '@/components/admin/admin-request';

interface AdminCohort {
  id: string;
  name: string;
  program: string;
  startsAt: string;
  endsAt: string;
  joinOpen: boolean;
  archivedAt: string | null;
  _count: { members: number; projects: number };
}

const day = (iso: string): string => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

function stage(c: AdminCohort): string {
  if (c.archivedAt) return 'Archived';
  const now = Date.now();
  if (new Date(c.endsAt).getTime() <= now) return 'Ended';
  if (new Date(c.startsAt).getTime() > now) return 'Upcoming';
  return 'Active';
}

export default function AdminBatchesPage(): React.ReactElement {
  const [cohorts, setCohorts] = useState<AdminCohort[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', program: '', startsAt: '', endsAt: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    adminRequest<{ cohorts: AdminCohort[]; enabled: boolean }>('/api/admin/cohorts')
      .then((d) => { setCohorts(d.cohorts); setEnabled(d.enabled); setError(null); })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(load, [load]);

  const create = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setSaving(true);
    try {
      // The end date is inclusive: the batch runs until the end of that day.
      await adminRequest('/api/admin/cohorts', { method: 'POST', body: { ...form, endsAt: `${form.endsAt}T23:59:59` } });
      toast.success(`Created ${form.name}`);
      setForm({ name: '', program: '', startsAt: '', endsAt: '' });
      load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (error) return <p className="text-sm text-destructive" role="alert">{error}</p>;
  if (!cohorts) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-6">
      {!enabled && (
        <p role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          Batches are switched off: join links don&apos;t work and mentors have no access.{' '}
          <Link href="/dashboard/admin/settings" className="underline underline-offset-4">Turn them on in Settings</Link>.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <caption className="sr-only">Batches</caption>
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="pb-2 pr-4">Batch</th>
              <th className="pb-2 pr-4">Dates</th>
              <th className="pb-2 pr-4">Stage</th>
              <th className="pb-2 pr-4">Joining</th>
              <th className="pb-2 pr-4">Members</th>
              <th className="pb-2">Projects</th>
            </tr>
          </thead>
          <tbody>
            {cohorts.map((c) => (
              <tr key={c.id} className="border-b">
                <td className="py-3 pr-4">
                  <Link href={`/dashboard/admin/batches/${c.id}`} className="font-medium underline-offset-4 hover:underline">{c.name}</Link>
                  <div className="text-xs text-muted-foreground">{c.program}</div>
                </td>
                <td className="py-3 pr-4 text-xs text-muted-foreground">{day(c.startsAt)} – {day(c.endsAt)}</td>
                <td className="py-3 pr-4">{stage(c)}</td>
                <td className="py-3 pr-4">{c.joinOpen ? 'Open' : 'Closed'}</td>
                <td className="py-3 pr-4 tabular-nums">{c._count.members}</td>
                <td className="py-3 tabular-nums">{c._count.projects}</td>
              </tr>
            ))}
            {cohorts.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-muted-foreground">No batches yet. Create the first one below.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-base">New batch</CardTitle>
          <CardDescription>You get a join link to share with the students. Add mentors on the batch&apos;s page.</CardDescription>
        </CardHeader>
        <CardContent>
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
              <Input id="batch-end" type="date" required value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create batch'}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
