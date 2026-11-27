'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ExternalLink, ScrollText, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CopyValue } from '@/components/ui/copy-value';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { adminRequest } from '@/components/admin/admin-request';
import { NoPasswordPill, batchStage, formatDay } from '@/components/admin/batch-status';
import { AddStudentsDialog } from '@/components/features/add-students-dialog';
import { getProjectUrl } from '@/components/ui/framework-logo';
import { DeploymentFailure } from '@/components/features/deployment-failure';

/** GET /api/cohorts/[cohortId]: joinLink is null while joining is closed. */
interface BatchView {
  cohort: { id: string; name: string; program: string; startsAt: string; endsAt: string; archivedAt: string | null };
  joinLink: string | null;
  students: Array<{ userId: string; email: string; name: string | null; joinedAt: string; passwordSet: boolean; projectCount: number }>;
}

interface CohortProject {
  id: string;
  name: string;
  slug: string;
  type: string;
  isPrivate: boolean;
  user: { id: string; email: string; name: string | null };
  deployments: Array<{
    id: string; status: string; containerPort: number | null; createdAt: string;
    buildStep: string | null; failureReason: string | null;
  }>;
}

interface DeploymentRow {
  id: string;
  status: string;
  createdAt: string;
}

interface BuildLog {
  id: string;
  status: string;
  buildLog: string | null;
}

const STATUS_STYLE: Record<string, string> = {
  DEPLOYED: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  FAILED: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  BUILDING: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  QUEUED: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
};

function Status({ status }: { status: string }): React.ReactElement {
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLE[status] ?? 'bg-muted text-muted-foreground'}`}>
      {status}
    </span>
  );
}

/** Mentors of the batch and admins: students, adding students, and read-only projects. The API answers everyone else with a 404. */
export default function BatchProjectsPage({ params }: { params: Promise<{ cohortId: string }> }): React.ReactElement {
  const { cohortId } = use(params);
  const [batch, setBatch] = useState<BatchView | null>(null);
  const [projects, setProjects] = useState<CohortProject[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [logsFor, setLogsFor] = useState<CohortProject | null>(null);
  const [deployments, setDeployments] = useState<DeploymentRow[] | null>(null);
  const [log, setLog] = useState<BuildLog | null>(null);
  const [logError, setLogError] = useState<string | null>(null);

  const loadBatch = useCallback(() => adminRequest<BatchView>(`/api/cohorts/${cohortId}`).then(setBatch), [cohortId]);

  useEffect(() => {
    loadBatch().catch((e: Error) => setError(e.message));
  }, [loadBatch]);

  useEffect(() => {
    adminRequest<CohortProject[]>(`/api/cohorts/${cohortId}/projects`).then(setProjects).catch((e: Error) => setError(e.message));
  }, [cohortId]);

  const base = (projectId: string): string => `/api/cohorts/${cohortId}/projects/${projectId}/deployments`;

  const showLog = (projectId: string, deploymentId: string): void => {
    setLog(null);
    setLogError(null);
    adminRequest<BuildLog>(`${base(projectId)}/${deploymentId}/log`).then(setLog).catch((e: Error) => setLogError(e.message));
  };

  const openLogs = (project: CohortProject): void => {
    setLogsFor(project);
    setDeployments(null);
    setLog(null);
    setLogError(null);
    adminRequest<DeploymentRow[]>(base(project.id))
      .then((rows) => {
        setDeployments(rows);
        if (rows[0]) showLog(project.id, rows[0].id);
      })
      .catch((e: Error) => setLogError(e.message));
  };

  if (error) return <p className="text-sm text-destructive" role="alert">{error}</p>;
  if (!batch || !projects) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const { cohort, joinLink, students } = batch;
  const stage = batchStage(cohort);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link href="/dashboard/batches" className="text-sm text-muted-foreground hover:text-foreground">← Your batches</Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">{cohort.name}</h1>
            <p className="text-sm text-muted-foreground">
              {cohort.program} · {formatDay(cohort.startsAt)} – {formatDay(cohort.endsAt)}
            </p>
          </div>
          {stage !== 'Archived' && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Users className="mr-1 h-4 w-4" aria-hidden />Add students
            </Button>
          )}
        </div>
      </div>

      <div className="max-w-lg">
        {joinLink ? (
          // Rendered only after the client fetch, so window is defined.
          <CopyValue label="Join link" hint="students sign up and join with it" value={`${window.location.origin}${joinLink}`} />
        ) : (
          <p className="text-sm text-muted-foreground">
            {stage === 'Archived'
              ? 'This batch is archived.'
              : stage === 'Ended'
                ? 'This batch has ended, so its join link no longer works.'
                : 'Joining is closed. Add students by email, or ask an admin to open joining.'}
          </p>
        )}
      </div>

      <section className="space-y-3" aria-labelledby="students-heading">
        <h2 id="students-heading" className="text-base font-semibold">Students</h2>
        <div className="relative overflow-x-auto">
          {/* relative: keeps the sr-only caption inside the scroll box, so phones get no page-wide scroll. */}
          <table className="w-full text-sm border-collapse">
            <caption className="sr-only">Students in {cohort.name}</caption>
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="pb-2 pr-4">Student</th>
                <th className="hidden pb-2 pr-4 sm:table-cell">Joined</th>
                <th className="pb-2 text-right">Projects</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.userId} className="border-b align-top">
                  <td className="min-w-48 py-3 pr-4">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium">{s.name ?? s.email}</span>
                      {!s.passwordSet && <NoPasswordPill />}
                    </div>
                    {s.name && <div className="text-xs text-muted-foreground">{s.email}</div>}
                  </td>
                  <td className="hidden whitespace-nowrap py-3 pr-4 text-xs sm:table-cell">{formatDay(s.joinedAt)}</td>
                  <td className="py-3 text-right tabular-nums">{s.projectCount}</td>
                </tr>
              ))}
              {students.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-8 text-center text-muted-foreground">No students yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="projects-heading">
        <div>
          <h2 id="projects-heading" className="text-base font-semibold">Students&apos; projects</h2>
          <p className="text-sm text-muted-foreground">Read-only. Environment variables and the terminal stay with each student.</p>
        </div>
        <div className="relative overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <caption className="sr-only">Projects in this batch</caption>
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="pb-2 pr-4">Student</th>
                <th className="pb-2 pr-4">Project</th>
                <th className="pb-2 pr-4">Latest deploy</th>
                <th className="pb-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => {
                const latest = p.deployments[0];
                return (
                  <tr key={p.id} className="border-b align-top">
                    <td className="py-3 pr-4">
                      <div className="font-medium">{p.user.name ?? p.user.email}</div>
                      {p.user.name && <div className="text-xs text-muted-foreground">{p.user.email}</div>}
                    </td>
                    <td className="py-3 pr-4">
                      {p.name}
                      <div className="text-xs text-muted-foreground">{p.type}{p.isPrivate ? ' · private' : ''}</div>
                    </td>
                    <td className="py-3 pr-4">
                      {latest ? <Status status={latest.status} /> : <span className="text-xs text-muted-foreground">Never deployed</span>}
                      {latest?.status === 'FAILED' && (
                        <DeploymentFailure buildStep={latest.buildStep} failureReason={latest.failureReason} className="mt-1 max-w-xs" />
                      )}
                    </td>
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        {latest?.status === 'DEPLOYED' && (
                          <a
                            href={getProjectUrl(p.slug, latest.containerPort)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" /> Open site
                          </a>
                        )}
                        {latest && (
                          <button
                            type="button"
                            onClick={() => openLogs(p)}
                            className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <ScrollText className="w-3.5 h-3.5" aria-hidden="true" /> Build logs
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {projects.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-muted-foreground">No projects in this batch yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* A failed reload must not replace the page: the dialog may hold links shown only once. */}
      <AddStudentsDialog
        cohortId={cohortId}
        open={adding}
        onOpenChange={setAdding}
        onDone={() => loadBatch().catch((e: Error) => toast.error(e.message))}
      />

      <Dialog open={logsFor !== null} onOpenChange={(open) => !open && setLogsFor(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{logsFor?.name}: build logs</DialogTitle>
            <DialogDescription>The last 10 deployments. Pick one to read its log.</DialogDescription>
          </DialogHeader>
          {logsFor && deployments && (
            <div className="flex flex-wrap gap-1">
              {deployments.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => showLog(logsFor.id, d.id)}
                  aria-pressed={log?.id === d.id}
                  className={`px-2 py-1 rounded-md text-xs border ${log?.id === d.id ? 'bg-muted' : 'hover:bg-muted/50'}`}
                >
                  {new Date(d.createdAt).toLocaleString()} · {d.status}
                </button>
              ))}
            </div>
          )}
          {logError && <p className="text-sm text-destructive" role="alert">{logError}</p>}
          <pre className="max-h-[50vh] overflow-auto rounded-md bg-zinc-950 p-3 text-xs text-zinc-200 whitespace-pre-wrap break-words">
            {log ? log.buildLog || 'This deployment has no log.' : 'Loading…'}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}
