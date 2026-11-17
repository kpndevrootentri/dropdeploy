'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, ScrollText } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { adminRequest } from '@/components/admin/admin-request';
import { getProjectUrl } from '@/components/ui/framework-logo';

interface CohortProject {
  id: string;
  name: string;
  slug: string;
  type: string;
  isPrivate: boolean;
  user: { id: string; email: string; name: string | null };
  deployments: Array<{ id: string; status: string; containerPort: number | null; createdAt: string }>;
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

/** Read-only: mentors of the batch and admins. The API answers everyone else with a 404. */
export default function BatchProjectsPage({ params }: { params: Promise<{ cohortId: string }> }): React.ReactElement {
  const { cohortId } = use(params);
  const [projects, setProjects] = useState<CohortProject[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logsFor, setLogsFor] = useState<CohortProject | null>(null);
  const [deployments, setDeployments] = useState<DeploymentRow[] | null>(null);
  const [log, setLog] = useState<BuildLog | null>(null);
  const [logError, setLogError] = useState<string | null>(null);

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
  if (!projects) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-4">
      <div>
        <Link href="/dashboard/batches" className="text-sm text-muted-foreground hover:text-foreground">← Your batches</Link>
        <h1 className="text-xl font-semibold tracking-tight">Students&apos; projects</h1>
        <p className="text-sm text-muted-foreground">Read-only. Environment variables and the terminal stay with each student.</p>
      </div>
      <div className="overflow-x-auto">
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
