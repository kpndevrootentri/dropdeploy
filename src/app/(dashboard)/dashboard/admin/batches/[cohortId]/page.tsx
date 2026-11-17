'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CopyValue } from '@/components/ui/copy-value';
import { adminRequest } from '@/components/admin/admin-request';

interface Member {
  userId: string;
  role: 'STUDENT' | 'MENTOR';
  joinedAt: string;
  endedAt: string | null;
  projectCount: number;
  user: { email: string; name: string | null };
}

interface Detail {
  cohort: {
    id: string;
    name: string;
    program: string;
    startsAt: string;
    endsAt: string;
    joinCode: string;
    joinOpen: boolean;
    archivedAt: string | null;
  };
  members: Member[];
}

const day = (iso: string): string => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export default function AdminBatchPage({ params }: { params: Promise<{ cohortId: string }> }): React.ReactElement {
  const { cohortId } = use(params);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [mentorEmail, setMentorEmail] = useState('');

  const load = useCallback(() => {
    adminRequest<Detail>(`/api/admin/cohorts/${cohortId}`)
      .then((d) => { setDetail(d); setError(null); })
      .catch((e: Error) => setError(e.message));
  }, [cohortId]);

  useEffect(load, [load]);

  // Resolves to whether the action worked; errors are shown as a toast.
  const run = async (fn: () => Promise<unknown>, done: string): Promise<boolean> => {
    setActing(true);
    try {
      await fn();
      toast.success(done);
      load();
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      setActing(false);
    }
  };

  if (error) return <p className="text-sm text-destructive" role="alert">{error}</p>;
  if (!detail) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const { cohort, members } = detail;
  const patch = (body: Record<string, unknown>) => adminRequest(`/api/admin/cohorts/${cohortId}`, { method: 'PATCH', body });
  const current = members.filter((m) => !m.endedAt);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard/admin/batches" className="text-sm text-muted-foreground hover:text-foreground">← All batches</Link>
        <h2 className="text-lg font-semibold">{cohort.name}</h2>
        <p className="text-sm text-muted-foreground">
          {cohort.program} · {day(cohort.startsAt)} – {day(cohort.endsAt)}
          {cohort.archivedAt ? ` · archived ${day(cohort.archivedAt)}` : ''}
        </p>
        <Link href={`/dashboard/batches/${cohort.id}`} className="text-sm underline underline-offset-4">View projects and build logs</Link>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-base">Join link</CardTitle>
          <CardDescription>
            Anyone with this link can create an account and join as a student, even when sign-up is closed. Close joining or get a new link if it leaks.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Rendered only after the client fetch, so window is defined. */}
          <CopyValue label="Join link" value={`${window.location.origin}/join/${cohort.joinCode}`} />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={acting} onClick={() => void run(() => patch({ joinOpen: !cohort.joinOpen }), cohort.joinOpen ? 'Joining closed' : 'Joining opened')}>
              {cohort.joinOpen ? 'Close joining' : 'Open joining'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={acting}
              onClick={() => {
                if (!confirm('Get a new join link? The current link stops working immediately.')) return;
                void run(() => adminRequest(`/api/admin/cohorts/${cohortId}/join-code`, { method: 'POST' }), 'New join link ready');
              }}
            >
              New join link
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={acting}
              onClick={() => {
                if (!cohort.archivedAt && !confirm(`Archive ${cohort.name}? Nobody can join, new projects are not added to it, and mentors lose access. Sites keep running.`)) return;
                void run(() => patch({ archived: !cohort.archivedAt }), cohort.archivedAt ? 'Batch restored' : 'Batch archived');
              }}
            >
              {cohort.archivedAt ? 'Restore batch' : 'Archive batch'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-base">Add a mentor</CardTitle>
          <CardDescription>Mentors see this batch&apos;s projects, private sites and build logs, read-only. They need an Entrify account.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => adminRequest(`/api/admin/cohorts/${cohortId}/mentors`, { method: 'POST', body: { email: mentorEmail } }), `Added ${mentorEmail}`)
                .then((ok) => ok && setMentorEmail(''));
            }}
          >
            <Label htmlFor="mentor-email" className="sr-only">Mentor email</Label>
            <Input id="mentor-email" type="email" required placeholder="mentor@entri.me" value={mentorEmail} onChange={(e) => setMentorEmail(e.target.value)} />
            <Button type="submit" disabled={acting}>Add</Button>
          </form>
        </CardContent>
      </Card>

      <div className="overflow-x-auto">
        <h3 className="text-sm font-medium mb-2">Members ({current.length} current)</h3>
        <table className="w-full text-sm border-collapse">
          <caption className="sr-only">Members of {cohort.name}</caption>
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="pb-2 pr-4">Person</th>
              <th className="pb-2 pr-4">Role</th>
              <th className="pb-2 pr-4">Joined</th>
              <th className="pb-2 pr-4">Projects</th>
              <th className="pb-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.userId} className={`border-b ${m.endedAt ? 'text-muted-foreground' : ''}`}>
                <td className="py-3 pr-4">
                  <div className="font-medium">{m.user.name ?? m.user.email}</div>
                  {m.user.name && <div className="text-xs text-muted-foreground">{m.user.email}</div>}
                </td>
                <td className="py-3 pr-4">{m.role === 'MENTOR' ? 'Mentor' : 'Student'}</td>
                <td className="py-3 pr-4 text-xs">{day(m.joinedAt)}</td>
                <td className="py-3 pr-4 tabular-nums">{m.projectCount}</td>
                <td className="py-3">
                  {m.endedAt ? (
                    <span className="text-xs">Left {day(m.endedAt)}</span>
                  ) : (
                    <button
                      type="button"
                      disabled={acting}
                      onClick={() => {
                        if (!confirm(`End ${m.user.email}'s membership? Their projects stay in the batch.`)) return;
                        void run(() => adminRequest(`/api/admin/cohorts/${cohortId}/members/${m.userId}`, { method: 'DELETE' }), 'Membership ended');
                      }}
                      className="px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950 dark:hover:text-red-400 disabled:opacity-30"
                    >
                      End membership
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {members.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-muted-foreground">Nobody has joined yet. Share the join link.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
