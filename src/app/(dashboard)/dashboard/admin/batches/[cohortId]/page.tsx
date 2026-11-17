'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Archive, ArchiveRestore, ArrowLeft, FolderGit2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CopyValue } from '@/components/ui/copy-value';
import { adminRequest } from '@/components/admin/admin-request';
import { JoiningPill, RolePill, StagePill, batchStage, formatDay, isJoinable } from '@/components/admin/batch-status';

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

type MemberFilter = 'all' | 'students' | 'mentors' | 'left';

const DAY_MS = 86_400_000;
// Further out than this, a date reads better than a day count.
const COUNTDOWN_MAX_DAYS = 60;

const MEMBER_FILTERS: { key: MemberFilter; label: string; match: (m: Member) => boolean }[] = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'students', label: 'Students', match: (m) => !m.endedAt && m.role === 'STUDENT' },
  { key: 'mentors', label: 'Mentors', match: (m) => !m.endedAt && m.role === 'MENTOR' },
  { key: 'left', label: 'Left', match: (m) => !!m.endedAt },
];

/** "Ends in 12 days", "Starts in 3 days", "Ends 30 Jun 2027", "Ended 2 Jan 2027". */
function timeline(cohort: Detail['cohort']): { label: string; value: string } {
  const stage = batchStage(cohort);
  const daysUntil = (iso: string): number => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / DAY_MS));
  if (stage === 'Archived') return { label: 'Archived', value: formatDay(cohort.archivedAt as string) };
  if (stage === 'Ended') return { label: 'Ended', value: formatDay(cohort.endsAt) };
  const [verb, iso] = stage === 'Upcoming' ? ['Starts', cohort.startsAt] : ['Ends', cohort.endsAt];
  const days = daysUntil(iso);
  if (days > COUNTDOWN_MAX_DAYS) return { label: verb, value: formatDay(iso) };
  return { label: `${verb} in`, value: days === 1 ? '1 day' : `${days} days` };
}

function Stat({ label, value }: { label: string; value: string | number }): React.ReactElement {
  return (
    <div className="rounded-lg border px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export default function AdminBatchPage({ params }: { params: Promise<{ cohortId: string }> }): React.ReactElement {
  const { cohortId } = use(params);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [mentorEmail, setMentorEmail] = useState('');
  const [filter, setFilter] = useState<MemberFilter>('all');

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
  const stage = batchStage(cohort);
  const joinable = isJoinable(cohort);
  const count = (key: MemberFilter): number => members.filter(MEMBER_FILTERS.find((f) => f.key === key)!.match).length;
  const shown = members.filter(MEMBER_FILTERS.find((f) => f.key === filter)!.match);
  const projects = members.reduce((sum, m) => sum + m.projectCount, 0);
  const when = timeline(cohort);

  const toggleArchive = (): void => {
    if (!cohort.archivedAt && !confirm(`Archive ${cohort.name}? Nobody can join, new projects are not added to it, and mentors lose access. Sites keep running.`)) return;
    void run(() => patch({ archived: !cohort.archivedAt }), cohort.archivedAt ? 'Batch restored' : 'Batch archived');
  };

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link href="/dashboard/admin/batches" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" aria-hidden />Batches
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-2xl font-bold">{cohort.name}</h2>
              <StagePill stage={stage} />
              <JoiningPill open={joinable} long />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {cohort.program} · {formatDay(cohort.startsAt)} – {formatDay(cohort.endsAt)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link href={`/dashboard/batches/${cohort.id}`}><FolderGit2 className="mr-1 h-4 w-4" aria-hidden />Projects and build logs</Link>
            </Button>
            <Button variant="outline" disabled={acting} onClick={toggleArchive}>
              {cohort.archivedAt
                ? <><ArchiveRestore className="mr-1 h-4 w-4" aria-hidden />Restore batch</>
                : <><Archive className="mr-1 h-4 w-4" aria-hidden />Archive batch</>}
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Students" value={count('students')} />
        <Stat label="Mentors" value={count('mentors')} />
        <Stat label="Projects" value={projects} />
        <Stat label={when.label} value={when.value} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* First in the markup so phones show the join link before the member list. */}
        <div className="min-w-0 space-y-6 lg:col-start-3 lg:row-start-1">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base">Join link</CardTitle>
                <JoiningPill open={joinable} />
              </div>
              <CardDescription>Students sign up and join with this link, even when sign-up is closed.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Rendered only after the client fetch, so window is defined. */}
              <CopyValue label="Join link" value={`${window.location.origin}/join/${cohort.joinCode}`} />
              {(stage === 'Ended' || stage === 'Archived') && (
                <p className="text-xs text-muted-foreground">The link doesn&apos;t work because the batch has {stage === 'Ended' ? 'ended' : 'been archived'}.</p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" disabled={acting} onClick={() => void run(() => patch({ joinOpen: !cohort.joinOpen }), cohort.joinOpen ? 'Joining closed' : 'Joining opened')}>
                  {cohort.joinOpen ? 'Close joining' : 'Open joining'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={acting}
                  title="Use this if the link leaked"
                  onClick={() => {
                    if (!confirm('Get a new join link? The current link stops working immediately.')) return;
                    void run(() => adminRequest(`/api/admin/cohorts/${cohortId}/join-code`, { method: 'POST' }), 'New join link ready');
                  }}
                >
                  <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden />New link
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
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
        </div>

        <section className="min-w-0 space-y-3 lg:col-span-2 lg:row-start-1" aria-labelledby="members-heading">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="members-heading" className="text-base font-semibold">Members</h3>
            <div className="inline-flex rounded-lg border p-0.5" role="group" aria-label="Show members">
              {MEMBER_FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={filter === f.key}
                  onClick={() => setFilter(f.key)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${filter === f.key ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {f.label} <span className="tabular-nums opacity-70">{count(f.key)}</span>
                </button>
              ))}
            </div>
          </div>

          {/* relative: keeps the sr-only caption inside the scroll box, so phones get no page-wide scroll. */}
          <div className="relative overflow-x-auto rounded-lg border">
            <table className="w-full text-sm border-collapse">
              <caption className="sr-only">Members of {cohort.name}</caption>
              <thead className="bg-muted/40">
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Person</th>
                  <th className="w-24 px-4 py-2 font-medium">Role</th>
                  <th className="hidden w-32 px-4 py-2 font-medium sm:table-cell">Joined</th>
                  <th className="w-20 px-4 py-2 text-right font-medium">Projects</th>
                  <th className="w-40 px-4 py-2 text-right font-medium"><span className="sr-only">Status or action</span></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((m) => (
                  <tr key={m.userId} className={`border-b last:border-0 ${m.endedAt ? 'text-muted-foreground' : ''}`}>
                    <td className="min-w-48 px-4 py-3">
                      <div className="font-medium">{m.user.name ?? m.user.email}</div>
                      {m.user.name && <div className="text-xs text-muted-foreground">{m.user.email}</div>}
                    </td>
                    <td className="px-4 py-3"><RolePill role={m.role} /></td>
                    <td className="hidden whitespace-nowrap px-4 py-3 text-xs sm:table-cell">{formatDay(m.joinedAt)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{m.projectCount}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      {m.endedAt ? (
                        <span className="text-xs">Left {formatDay(m.endedAt)}</span>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={acting}
                          onClick={() => {
                            if (!confirm(`End ${m.user.email}'s membership? Their projects stay in the batch.`)) return;
                            void run(() => adminRequest(`/api/admin/cohorts/${cohortId}/members/${m.userId}`, { method: 'DELETE' }), 'Membership ended');
                          }}
                          className="text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950 dark:hover:text-red-400"
                        >
                          End membership
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                      {members.length === 0 ? 'Nobody has joined yet. Share the join link with the students.' : 'Nobody here.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
