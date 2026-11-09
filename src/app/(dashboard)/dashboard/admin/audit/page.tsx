'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

interface AdminAction {
  id: string;
  actorEmail: string;
  action: string;
  targetType: string;
  targetLabel: string;
  meta: unknown;
  createdAt: string;
}

/** USER_ROLE_CHANGED → "User role changed". */
const humanize = (action: string): string =>
  action.charAt(0) + action.slice(1).toLowerCase().replace(/_/g, ' ');

export default function AdminAuditPage(): React.ReactElement {
  const [actions, setActions] = useState<AdminAction[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((before?: string) => {
    setLoading(true);
    setError(null);
    fetch(`/api/admin/audit${before ? `?before=${encodeURIComponent(before)}` : ''}`)
      .then((r) => r.json())
      .then((body) => {
        if (!body.success) throw new Error(body?.error?.message ?? body?.error ?? 'Failed to load the audit log');
        setActions((prev) => (before ? [...prev, ...body.data.actions] : body.data.actions));
        setHasMore(body.data.hasMore);
      })
      .catch((err: Error) => setError(err.message || 'Failed to load the audit log'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold">Audit log</h2>
        <p className="text-sm text-muted-foreground">Every change made from the admin panel, newest first.</p>
      </div>

      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="pb-2 pr-4">When</th>
              <th className="pb-2 pr-4">Admin</th>
              <th className="pb-2 pr-4">Action</th>
              <th className="pb-2 pr-4">Target</th>
              <th className="pb-2">Details</th>
            </tr>
          </thead>
          <tbody>
            {actions.map((a) => {
              const details = a.meta ? JSON.stringify(a.meta) : '';
              return (
                <tr key={a.id} className="border-b align-top">
                  <td className="py-2 pr-4 whitespace-nowrap text-muted-foreground">
                    {new Date(a.createdAt).toLocaleString()}
                  </td>
                  <td className="py-2 pr-4">{a.actorEmail}</td>
                  <td className="py-2 pr-4 whitespace-nowrap font-medium">{humanize(a.action)}</td>
                  <td className="py-2 pr-4">
                    <span className="text-xs text-muted-foreground mr-1">{a.targetType.toLowerCase()}</span>
                    {a.targetLabel}
                  </td>
                  <td className="py-2 max-w-xs">
                    <code className="block truncate font-mono text-xs text-muted-foreground" title={details}>
                      {details}
                    </code>
                  </td>
                </tr>
              );
            })}
            {!loading && actions.length === 0 && !error && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-muted-foreground">No admin actions recorded yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!loading && hasMore && (
        <Button variant="outline" onClick={() => load(actions[actions.length - 1]?.id)}>
          Load more
        </Button>
      )}
    </div>
  );
}
