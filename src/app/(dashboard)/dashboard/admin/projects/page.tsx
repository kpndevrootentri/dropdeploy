'use client';

import { useEffect, useState, useCallback } from 'react';
import { getProjectUrl } from '@/components/ui/framework-logo';
import React from 'react';
import {
  Square, RotateCcw, Rocket, Trash2, Loader2,
  ChevronDown, ChevronUp, Container, Cpu, MemoryStick, Clock, Hash, Network,
} from 'lucide-react';

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
  user: ProjectOwner;
  deployments: Deployment[];
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

function formatBytes(bytes: number): string {
  if (bytes === 0) return '—';
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
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

export default function AdminProjectsPage(): React.ReactElement {
  const [projects, setProjects] = useState<AdminProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const TRANSITIONAL = ['QUEUED', 'BUILDING'];

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    return fetch('/api/admin/projects')
      .then((r) => r.json())
      .then((res) => { setProjects(res.data ?? []); return res.data ?? []; })
      .catch(() => [])
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
        alert(body?.error ?? 'Action failed');
        return;
      }
      void load();
    } catch {
      alert('Network error');
    } finally {
      setActing(null);
    }
  };

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-4">
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
              const canExpand    = latestDeployment?.status === 'DEPLOYED';

              return (
                <React.Fragment key={p.id}>
                  <tr className={`border-b ${isOpen ? 'bg-muted/30' : ''}`}>
                    {/* Expand toggle */}
                    <td className="py-3 pr-2">
                      <button
                        disabled={!canExpand}
                        onClick={() => toggleExpanded(p.id)}
                        title={canExpand ? 'Show container details' : 'No container (not deployed)'}
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
                      {latestDeployment ? (
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                          latestDeployment.status === 'DEPLOYED' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' :
                          latestDeployment.status === 'FAILED'   ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' :
                          latestDeployment.status === 'BUILDING' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' :
                          'bg-muted text-muted-foreground'
                        }`}>
                          {latestDeployment.status}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      {latestDeployment?.status === 'DEPLOYED' ? (
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
                          disabled={!!isActing || !['DEPLOYED', 'BUILDING'].includes(latestDeployment?.status ?? '')}
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
                        </div>
                        <ContainerDetails projectId={p.id} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {projects.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-muted-foreground">
                  No projects found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
