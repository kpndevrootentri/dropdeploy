'use client';

import { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';

interface Deployment {
  id: string;
  status: string;
  createdAt: string;
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

export default function AdminProjectsPage(): React.ReactElement {
  const [projects, setProjects] = useState<AdminProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/admin/projects')
      .then((r) => r.json())
      .then((res) => setProjects(res.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const action = async (url: string, method: string, projectId: string): Promise<void> => {
    setActing(projectId + method);
    try {
      const res = await fetch(url, { method });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body?.error ?? 'Action failed');
        return;
      }
      load();
    } catch {
      alert('Network error');
    } finally {
      setActing(null);
    }
  };

  const handleTransfer = async (projectId: string): Promise<void> => {
    const newOwnerId = window.prompt('Enter new owner user ID:');
    if (!newOwnerId) return;
    setActing(projectId + 'transfer');
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/transfer`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newOwnerId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body?.error ?? 'Transfer failed');
        return;
      }
      load();
    } catch {
      alert('Network error');
    } finally {
      setActing(null);
    }
  };

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">All Projects</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="pb-2 pr-4">Name</th>
              <th className="pb-2 pr-4">Owner</th>
              <th className="pb-2 pr-4">Type</th>
              <th className="pb-2 pr-4">Latest Status</th>
              <th className="pb-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => {
              const latestDeployment = p.deployments[0];
              const isActing = acting?.startsWith(p.id);
              return (
                <tr key={p.id} className="border-b">
                  <td className="py-3 pr-4 font-medium">{p.name}</td>
                  <td className="py-3 pr-4 text-muted-foreground">{p.user.email}</td>
                  <td className="py-3 pr-4">{p.type}</td>
                  <td className="py-3 pr-4">
                    {latestDeployment ? (
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                        latestDeployment.status === 'DEPLOYED' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' :
                        latestDeployment.status === 'FAILED' ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' :
                        latestDeployment.status === 'BUILDING' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' :
                        'bg-muted text-muted-foreground'
                      }`}>
                        {latestDeployment.status}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-3">
                    <div className="flex flex-wrap gap-1">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={!!isActing}
                        onClick={() => action(`/api/admin/projects/${p.id}/stop`, 'POST', p.id)}
                      >
                        Stop
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={!!isActing}
                        onClick={() => action(`/api/admin/projects/${p.id}/restart`, 'POST', p.id)}
                      >
                        Restart
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={!!isActing}
                        onClick={() => action(`/api/admin/projects/${p.id}/deploy`, 'POST', p.id)}
                      >
                        Redeploy
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={!!isActing}
                        onClick={() => handleTransfer(p.id)}
                      >
                        Transfer
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={!!isActing}
                        onClick={() => {
                          if (!confirm(`Delete project "${p.name}"? This cannot be undone.`)) return;
                          void action(`/api/admin/projects/${p.id}`, 'DELETE', p.id);
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {projects.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-muted-foreground">
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
