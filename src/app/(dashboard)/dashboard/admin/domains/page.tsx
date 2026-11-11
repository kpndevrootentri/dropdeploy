'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, RefreshCw, Trash2, Star } from 'lucide-react';
import { adminRequest } from '@/components/admin/admin-request';

interface AdminDomain {
  id: string;
  hostname: string;
  status: string;
  isPrimary: boolean;
  lastError: string | null;
  failureCount: number;
  lastCheckedAt: string | null;
  verifiedAt: string | null;
  createdAt: string;
  project: { id: string; name: string; slug: string; user: { email: string } };
}

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  FAILED: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  VERIFIED: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  PROVISIONING: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
};

const when = (iso: string | null): string => (iso ? new Date(iso).toLocaleString() : '—');

export default function AdminDomainsPage(): React.ReactElement {
  const [domains, setDomains] = useState<AdminDomain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(() => {
    adminRequest<AdminDomain[]>('/api/admin/domains')
      .then((data) => { setDomains(data); setError(null); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const run = async (key: string, fn: () => Promise<unknown>, done: string): Promise<void> => {
    setActing(key);
    try {
      await fn();
      toast.success(done);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setActing(null);
    }
  };

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-destructive" role="alert">{error}</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <caption className="sr-only">Custom domains across all projects</caption>
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="pb-2 pr-4">Hostname</th>
            <th className="pb-2 pr-4">Project</th>
            <th className="pb-2 pr-4">Owner</th>
            <th className="pb-2 pr-4">Status</th>
            <th className="pb-2 pr-4">Failures</th>
            <th className="pb-2 pr-4">Last checked</th>
            <th className="pb-2 pr-4">Verified</th>
            <th className="pb-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {domains.map((d) => (
            <tr key={d.id} className="border-b align-top">
              <td className="py-3 pr-4 font-medium">
                <span className="inline-flex items-center gap-1">
                  {d.isPrimary && <Star className="w-3.5 h-3.5 text-amber-500" aria-label="Primary domain" />}
                  {d.hostname}
                </span>
                {d.lastError && (
                  <p className="mt-1 max-w-xs text-xs text-destructive break-words">{d.lastError}</p>
                )}
              </td>
              <td className="py-3 pr-4">{d.project.name}</td>
              <td className="py-3 pr-4 text-xs text-muted-foreground">{d.project.user.email}</td>
              <td className="py-3 pr-4">
                <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLE[d.status] ?? 'bg-muted text-muted-foreground'}`}>
                  {d.status}
                </span>
              </td>
              <td className="py-3 pr-4 tabular-nums">{d.failureCount}</td>
              <td className="py-3 pr-4 text-xs text-muted-foreground">{when(d.lastCheckedAt)}</td>
              <td className="py-3 pr-4 text-xs text-muted-foreground">{when(d.verifiedAt)}</td>
              <td className="py-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={acting !== null}
                    onClick={() => void run(`${d.id}:verify`, () => adminRequest(`/api/admin/domains/${d.id}/verify`, { method: 'POST' }), `Checked ${d.hostname}`)}
                    className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                  >
                    {acting === `${d.id}:verify` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    Re-verify
                  </button>
                  <button
                    type="button"
                    disabled={acting !== null}
                    onClick={() => {
                      if (!confirm(`Remove ${d.hostname} from "${d.project.name}"? It stops routing immediately and the owner must add and verify it again.`)) return;
                      void run(`${d.id}:remove`, () => adminRequest(`/api/admin/domains/${d.id}`, { method: 'DELETE' }), `Removed ${d.hostname}`);
                    }}
                    className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950 dark:hover:text-red-400 disabled:opacity-30"
                  >
                    {acting === `${d.id}:remove` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    Remove
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {domains.length === 0 && (
            <tr>
              <td colSpan={8} className="py-8 text-center text-muted-foreground">No custom domains.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
