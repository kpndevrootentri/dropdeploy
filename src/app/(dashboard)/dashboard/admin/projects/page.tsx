'use client';

import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { getProjectUrl } from '@/components/ui/framework-logo';
import React from 'react';
import {
  Square, RotateCcw, Rocket, Trash2, Loader2,
  ChevronDown, ChevronUp, Container, Cpu, MemoryStick, Clock, Hash, Network, History, ArrowRightLeft, ScrollText,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { cn, formatBytes } from '@/lib/utils';

interface Deployment {
  id: string;
  status: string;
  createdAt: string;
  containerPort: number | null;
}

interface ProjectOwner {
  id: string;
  email: string;
  role: string;
}

interface AdminProject {
  id: string;
  name: string;
  slug: string;
  type: string;
  source: string;
  autoDeploy: boolean;
  user: ProjectOwner;
  deployments: Deployment[];
  stoppedAt: string | null;
  createdAt: string;
}

interface ContainerInfo {
  id: string;
  status: string;
  running: boolean;
  startedAt: string;
  image: string;
  ports: { hostPort: number; containerPort: number }[];
  cpuLimit: number;
  memoryLimitBytes: number;
  restartCount: number;
}

function formatUptime(startedAt: string): string {
  const diff = Date.now() - new Date(startedAt).getTime();
  if (diff < 0) return '—';
  const m = Math.floor(diff / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${m}m`;
}

function ContainerDetails({ projectId }: { projectId: string }): React.ReactElement {
  const [info, setInfo] = useState<ContainerInfo | null | 'loading' | 'none'>('loading');

  useEffect(() => {
    fetch(`/api/admin/projects/${projectId}/container`)
      .then((r) => r.json())
      .then((res) => setInfo(res.data ?? 'none'))
      .catch(() => setInfo('none'));
  }, [projectId]);

  if (info === 'loading') {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
        <Loader2 className="w-3 h-3 animate-spin" /> Fetching container info…
      </div>
    );
  }

  if (info === 'none' || !info) {
    return <p className="text-xs text-muted-foreground py-1">No container found for this project.</p>;
  }

  const rows: { icon: React.ReactNode; label: string; value: React.ReactNode }[] = [
    {
      icon: <Hash className="w-3.5 h-3.5" />,
      label: 'Container ID',
      value: <code className="font-mono">{info.id}</code>,
    },
    {
      icon: <Container className="w-3.5 h-3.5" />,
      label: 'Status',
      value: (
        <span className={`inline-flex items-center gap-1`}>
          <span className={`w-1.5 h-1.5 rounded-full ${info.running ? 'bg-green-500' : 'bg-red-400'}`} />
          <span className="capitalize">{info.status}</span>
        </span>
      ),
    },
    {
      icon: <Clock className="w-3.5 h-3.5" />,
      label: 'Uptime',
      value: info.running ? formatUptime(info.startedAt) : '—',
    },
    {
      icon: <Container className="w-3.5 h-3.5" />,
      label: 'Image',
      value: <code className="font-mono break-all">{info.image}</code>,
    },
    {
      icon: <Network className="w-3.5 h-3.5" />,
      label: 'Ports',
      value: info.ports.length > 0
        ? info.ports.map((p) => `${p.hostPort}→${p.containerPort}`).join(', ')
        : '—',
    },
    {
      icon: <Cpu className="w-3.5 h-3.5" />,
      label: 'CPU Shares',
      value: info.cpuLimit > 0 ? info.cpuLimit : '—',
    },
    {
      icon: <MemoryStick className="w-3.5 h-3.5" />,
      label: 'Memory Limit',
      value: formatBytes(info.memoryLimitBytes),
    },
    {
      icon: <RotateCcw className="w-3.5 h-3.5" />,
      label: 'Restart Count',
      value: info.restartCount,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-x-8 gap-y-2 py-2 sm:grid-cols-4">
      {rows.map(({ icon, label, value }) => (
        <div key={label} className="flex flex-col gap-0.5">
          <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
            {icon}{label}
          </span>
          <span className="text-xs text-foreground">{value}</span>
        </div>
      ))}
    </div>
  );
}

interface DeploymentSummary {
  id: string;
  status: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  commitHash: string | null;
  buildStep: string | null;
  rollbackOfId: string | null;
}

const DEPLOY_STATUS_CLASS: Record<string, string> = {
  DEPLOYED: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  FAILED: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  BUILDING: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
};

function formatDuration(startedAt: string | null, completedAt: string | null): string {
  if (!startedAt || !completedAt) return '—';
  const s = Math.round((new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

/** Dark, scrollable pane for build and container logs. */
function LogText({ className, children }: { className?: string; children: React.ReactNode }): React.ReactElement {
  return (
    <pre className={cn('mt-2 max-h-72 overflow-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-zinc-300 whitespace-pre-wrap break-all', className)}>
      {children}
    </pre>
  );
}

/** `latestStatus` is the table's polled status; a change means this list is out of date. */
function DeploymentHistory({ projectId, latestStatus }: { projectId: string; latestStatus?: string }): React.ReactElement {
  const [deployments, setDeployments] = useState<DeploymentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openLogId, setOpenLogId] = useState<string | null>(null);
  // Keyed by deployment so a slow response can never land under another row.
  const [logs, setLogs] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch(`/api/admin/projects/${projectId}/deployments`)
      .then((r) => r.json())
      .then((body) => {
        if (!body.success) throw new Error(body?.error?.message ?? body?.error ?? 'Failed to load deployments');
        setDeployments(body.data);
      })
      .catch((err: Error) => setError(err.message || 'Failed to load deployments'));
  }, [projectId, latestStatus]);

  const toggleLog = (deploymentId: string): void => {
    if (openLogId === deploymentId) {
      setOpenLogId(null);
      return;
    }
    setOpenLogId(deploymentId);
    const setLog = (text: string): void => setLogs((prev) => ({ ...prev, [deploymentId]: text }));
    // Re-fetched on every open: a building deployment's log keeps growing.
    fetch(`/api/admin/projects/${projectId}/deployments/${deploymentId}/logs`)
      .then((r) => r.json())
      .then((body) => {
        if (!body.success) throw new Error(body?.error?.message ?? body?.error ?? 'Failed to load the log');
        setLog(body.data.buildLog || 'No build log was recorded for this deployment.');
      })
      .catch((err: Error) => setLog(err.message || 'Failed to load the log'));
  };

  if (error) return <p className="text-xs text-destructive py-1" role="alert">{error}</p>;
  if (!deployments) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
        <Loader2 className="w-3 h-3 animate-spin" /> Fetching deployments…
      </div>
    );
  }
  if (deployments.length === 0) return <p className="text-xs text-muted-foreground py-1">No deployments yet.</p>;

  return (
    <ul className="divide-y text-xs">
      {deployments.map((d) => (
        <li key={d.id} className="py-1.5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className={`inline-block px-2 py-0.5 rounded font-medium ${DEPLOY_STATUS_CLASS[d.status] ?? 'bg-muted text-muted-foreground'}`}>
              {d.status}
            </span>
            <span className="text-muted-foreground">{new Date(d.createdAt).toLocaleString()}</span>
            <span className="text-muted-foreground">took {formatDuration(d.startedAt, d.completedAt)}</span>
            {d.commitHash && <code className="font-mono">{d.commitHash.slice(0, 7)}</code>}
            {d.rollbackOfId && <span className="text-muted-foreground">rollback</span>}
            {d.status === 'BUILDING' && d.buildStep && <span className="text-muted-foreground">{d.buildStep}</span>}
            <button
              type="button"
              onClick={() => toggleLog(d.id)}
              aria-expanded={openLogId === d.id}
              className="ml-auto text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
            >
              {openLogId === d.id ? 'Hide log' : 'View log'}
            </button>
          </div>
          {openLogId === d.id && <LogText>{logs[d.id] ?? 'Loading…'}</LogText>}
        </li>
      ))}
    </ul>
  );
}

const LOG_TAILS = [100, 200, 500];

function ContainerLogsDialog({ project, onClose }: { project: AdminProject | null; onClose: () => void }): React.ReactElement {
  const [tail, setTail] = useState(200);
  const [logs, setLogs] = useState<string | null>(null);
  const [refreshes, setRefreshes] = useState(0);

  useEffect(() => {
    if (!project) return;
    // A response for an earlier project or tail must not overwrite the current one.
    let current = true;
    setLogs(null);
    fetch(`/api/admin/projects/${project.id}/container/logs?tail=${tail}`)
      .then((r) => r.json())
      .then((body) => {
        if (!body.success) throw new Error(body?.error?.message ?? body?.error ?? 'Failed to load the logs');
        if (current) setLogs(body.data.logs === null ? 'No container found for this project.' : body.data.logs || '(no output)');
      })
      .catch((err: Error) => { if (current) setLogs(err.message || 'Failed to load the logs'); });
    return () => { current = false; };
  }, [project, tail, refreshes]);

  return (
    <Dialog open={!!project} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Container logs — dropdeploy-{project?.slug}</DialogTitle>
          <DialogDescription>
            Newest at the bottom. Logs can contain the owner&apos;s secrets; each view is recorded in the audit log.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 text-sm">
          <Label htmlFor="container-log-tail">Last</Label>
          <select
            id="container-log-tail"
            value={tail}
            onChange={(e) => setTail(Number(e.target.value))}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          >
            {LOG_TAILS.map((n) => <option key={n} value={n}>{n} lines</option>)}
          </select>
          <Button variant="outline" size="sm" className="ml-auto" disabled={logs === null} onClick={() => setRefreshes((n) => n + 1)}>
            {logs === null ? <Loader2 className="animate-spin" /> : <RotateCcw />} Refresh
          </Button>
        </div>
        <LogText className="max-h-[60vh]">{logs ?? 'Loading…'}</LogText>
      </DialogContent>
    </Dialog>
  );
}

interface OwnerCandidate {
  id: string;
  email: string;
  projectQuota: number;
  domainQuota: number;
  suspendedAt: string | null;
  _count: { projects: number; customDomains: number };
}

function TransferDialog({
  project,
  onClose,
  onDone,
}: {
  project: AdminProject | null;
  onClose: () => void;
  onDone: () => void;
}): React.ReactElement {
  const [users, setUsers] = useState<OwnerCandidate[] | null>(null);
  const [newOwnerId, setNewOwnerId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!project) return;
    setNewOwnerId('');
    setError(null);
    setUsers(null);
    fetch('/api/admin/users')
      .then((r) => r.json())
      .then((body) => {
        if (!body.success) throw new Error(body?.error?.message ?? body?.error ?? 'Failed to load users');
        setUsers(body.data);
      })
      .catch((err: Error) => setError(err.message || 'Failed to load users'));
  }, [project]);

  // A suspended user cannot sign in to manage the project.
  const candidates = (users ?? []).filter((u) => u.id !== project?.user.id && !u.suspendedAt);
  const chosen = candidates.find((u) => u.id === newOwnerId);
  const isGit = project?.source === 'GITHUB' || project?.source === 'GITLAB';

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!project || !newOwnerId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/projects/${project.id}/transfer`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newOwnerId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error?.message ?? body?.error ?? 'Transfer failed');
        return;
      }
      onDone();
    } catch {
      setError('Network error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!project} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Transfer project</DialogTitle>
        </DialogHeader>
        <form id="transfer-form" onSubmit={submit} className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            Move <span className="font-semibold text-foreground">{project?.name}</span> from{' '}
            <span className="font-semibold text-foreground">{project?.user.email}</span> to another user.
          </p>
          <div className="space-y-2">
            <Label htmlFor="transfer-owner">New owner</Label>
            <select
              id="transfer-owner"
              value={newOwnerId}
              onChange={(e) => setNewOwnerId(e.target.value)}
              required
              disabled={!users}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
            >
              <option value="">{users ? 'Choose a user…' : 'Loading users…'}</option>
              {candidates.map((u) => (
                <option key={u.id} value={u.id}>{u.email}</option>
              ))}
            </select>
          </div>
          {chosen && (
            <p className="text-xs text-muted-foreground">
              {chosen.email} has {chosen._count.projects} of {chosen.projectQuota} projects and{' '}
              {chosen._count.customDomains} of {chosen.domainQuota} custom domains.
              {chosen._count.projects >= chosen.projectQuota && (
                <span className="block mt-1 text-amber-600 dark:text-amber-400">
                  This puts them over their project quota. Transfers are not blocked by quota; raise it if needed.
                </span>
              )}
            </p>
          )}
          {isGit && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              Redeploys clone with the owner&apos;s connected {project?.source === 'GITHUB' ? 'GitHub' : 'GitLab'} account.
              If the repository is private and the new owner has not connected an account with access to it,
              the next redeploy will fail.
              {project?.autoDeploy && ' The push webhook stays registered under the previous owner’s account.'}
            </p>
          )}
          {error && <p className="text-destructive" role="alert">{error}</p>}
        </form>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" form="transfer-form" disabled={saving || !newOwnerId}>
            {saving ? 'Transferring…' : 'Transfer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminProjectsPage(): React.ReactElement {
  const [projects, setProjects] = useState<AdminProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [transferTarget, setTransferTarget] = useState<AdminProject | null>(null);
  const [logsTarget, setLogsTarget] = useState<AdminProject | null>(null);

  const TRANSITIONAL = ['QUEUED', 'BUILDING'];

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    return fetch('/api/admin/projects')
      .then((r) => r.json())
      .then((res) => {
        // On failure keep the last good list, so a failed poll doesn't empty the table.
        if (res.success) { setProjects(res.data ?? []); setError(null); }
        else setError(res.error?.message ?? 'Failed to load projects');
      })
      .catch(() => setError('Failed to load projects'))
      .finally(() => { if (!silent) setLoading(false); });
  }, []);

  // Poll every 3 s while any project has a transitional deployment status
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const hasTransitional = projects.some((p) =>
      TRANSITIONAL.includes(p.deployments[0]?.status ?? ''),
    );
    if (!hasTransitional) return;
    const id = setInterval(() => { void load(true); }, 3000);
    return () => clearInterval(id);
  }, [projects, load]);

  const toggleExpanded = (id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const action = async (url: string, method: string, key: string): Promise<void> => {
    setActing(key);
    try {
      const res = await fetch(url, { method });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body?.error?.message ?? body?.error ?? 'Action failed');
        return;
      }
      void load();
    } catch {
      toast.error('Network error');
    } finally {
      setActing(null);
    }
  };

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="pb-2 w-6" />
              <th className="pb-2 pr-4">Name</th>
              <th className="pb-2 pr-4">Owner</th>
              <th className="pb-2 pr-4">Type</th>
              <th className="pb-2 pr-4">Status</th>
              <th className="pb-2 pr-4">URL</th>
              <th className="pb-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => {
              const latestDeployment = p.deployments[0];
              const isActing = acting?.startsWith(p.id + ':');
              const isStopping   = acting === `${p.id}:stop`;
              const isRestarting = acting === `${p.id}:restart`;
              const isRedeploying = acting === `${p.id}:redeploy`;
              const isDeleting   = acting === `${p.id}:delete`;
              const isOpen       = expanded.has(p.id);
              const canExpand    = !!latestDeployment;
              // An admin stop leaves the deployment DEPLOYED; stoppedAt says the container is down.
              const isStopped    = latestDeployment?.status === 'DEPLOYED' && !!p.stoppedAt;

              return (
                <React.Fragment key={p.id}>
                  <tr className={`border-b ${isOpen ? 'bg-muted/30' : ''}`}>
                    {/* Expand toggle */}
                    <td className="py-3 pr-2">
                      <button
                        disabled={!canExpand}
                        onClick={() => toggleExpanded(p.id)}
                        title={canExpand ? 'Show container and deployments' : 'Never deployed'}
                        aria-label={isOpen ? 'Hide details' : 'Show details'}
                        aria-expanded={isOpen}
                        className="inline-flex items-center justify-center w-6 h-6 rounded text-muted-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>
                    </td>

                    <td className="py-3 pr-4 font-medium">{p.name}</td>
                    <td className="py-3 pr-4 text-muted-foreground text-xs">{p.user.email}</td>
                    <td className="py-3 pr-4">
                      <span className="inline-block px-2 py-0.5 rounded bg-muted text-muted-foreground text-xs font-medium">
                        {p.type}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      {isStopped ? (
                        <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                          STOPPED
                        </span>
                      ) : latestDeployment ? (
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${DEPLOY_STATUS_CLASS[latestDeployment.status] ?? 'bg-muted text-muted-foreground'}`}>
                          {latestDeployment.status}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      {latestDeployment?.status === 'DEPLOYED' && !isStopped ? (
                        <a
                          href={getProjectUrl(p.slug, latestDeployment.containerPort)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline dark:text-blue-400 text-xs"
                        >
                          {getProjectUrl(p.slug, latestDeployment.containerPort)}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        <button
                          title="Stop — Stops the running container without deleting the project"
                          disabled={!!isActing || isStopped || !['DEPLOYED', 'BUILDING'].includes(latestDeployment?.status ?? '')}
                          onClick={() => {
                            if (!confirm(`Stop container for "${p.name}"?`)) return;
                            void action(`/api/admin/projects/${p.id}/stop`, 'POST', `${p.id}:stop`);
                          }}
                          className="inline-flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md border border-transparent text-muted-foreground hover:bg-red-50 hover:text-red-600 hover:border-red-200 dark:hover:bg-red-950 dark:hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          {isStopping ? <Loader2 className="w-4 h-4 animate-spin" /> : <Square className="w-4 h-4" />}
                          <span className="text-[10px] leading-none font-medium">Stop</span>
                        </button>

                        <button
                          title="Restart — Stops and restarts the container with the current image"
                          disabled={!!isActing}
                          onClick={() => void action(`/api/admin/projects/${p.id}/restart`, 'POST', `${p.id}:restart`)}
                          className="inline-flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md border border-transparent text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          {isRestarting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                          <span className="text-[10px] leading-none font-medium">Restart</span>
                        </button>

                        <button
                          title="Redeploy — Pulls latest code and rebuilds the project from scratch"
                          disabled={!!isActing}
                          onClick={() => void action(`/api/admin/projects/${p.id}/deploy`, 'POST', `${p.id}:redeploy`)}
                          className="inline-flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md border border-transparent text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          {isRedeploying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
                          <span className="text-[10px] leading-none font-medium">Redeploy</span>
                        </button>

                        <button
                          title="Transfer — Give this project to another user"
                          disabled={!!isActing}
                          onClick={() => setTransferTarget(p)}
                          className="inline-flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md border border-transparent text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          <ArrowRightLeft className="w-4 h-4" />
                          <span className="text-[10px] leading-none font-medium">Transfer</span>
                        </button>

                        <div className="w-px h-8 bg-border" />

                        <button
                          title="Delete — Permanently removes the project, container, and all deployments"
                          disabled={!!isActing}
                          onClick={() => {
                            if (!confirm(`Delete project "${p.name}"? This cannot be undone.`)) return;
                            void action(`/api/admin/projects/${p.id}`, 'DELETE', `${p.id}:delete`);
                          }}
                          className="inline-flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md border border-transparent text-muted-foreground hover:bg-red-50 hover:text-red-600 hover:border-red-200 dark:hover:bg-red-950 dark:hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                          <span className="text-[10px] leading-none font-medium">Delete</span>
                        </button>
                      </div>
                    </td>
                  </tr>

                  {/* Container details expansion row */}
                  {isOpen && (
                    <tr className="border-b bg-muted/20">
                      <td />
                      <td colSpan={6} className="px-3 pb-3 pt-1">
                        <div className="flex items-center gap-2 mb-2">
                          <Container className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            Container Details — dropdeploy-{p.slug}
                          </span>
                          <Button variant="outline" size="sm" className="ml-auto h-7 px-2 text-xs" onClick={() => setLogsTarget(p)}>
                            <ScrollText /> Container logs
                          </Button>
                        </div>
                        <ContainerDetails projectId={p.id} />
                        <div className="flex items-center gap-2 mt-3 mb-1">
                          <History className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            Recent deployments
                          </span>
                        </div>
                        <DeploymentHistory projectId={p.id} latestStatus={latestDeployment?.status} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {projects.length === 0 && !error && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-muted-foreground">
                  No projects found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <TransferDialog
        project={transferTarget}
        onClose={() => setTransferTarget(null)}
        onDone={() => { setTransferTarget(null); void load(); }}
      />
      <ContainerLogsDialog project={logsTarget} onClose={() => setLogsTarget(null)} />
    </div>
  );
}
