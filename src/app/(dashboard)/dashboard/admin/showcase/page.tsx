'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ExternalLink, Eye, EyeOff, Loader2, Star } from 'lucide-react';
import { adminRequest } from '@/components/admin/admin-request';

interface AdminShowcase {
  projectId: string;
  shortDescription: string;
  isPublished: boolean;
  publishedAt: string | null;
  featured: boolean;
  viewCount: number;
  project: { name: string; slug: string; user: { email: string } };
}

export default function AdminShowcasePage(): React.ReactElement {
  const [entries, setEntries] = useState<AdminShowcase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(() => {
    adminRequest<AdminShowcase[]>('/api/admin/showcase')
      .then((data) => { setEntries(data); setError(null); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const setFlags = async (s: AdminShowcase, flags: { isPublished?: boolean; featured?: boolean }): Promise<void> => {
    setActing(s.projectId);
    try {
      await adminRequest(`/api/admin/showcase/${s.projectId}`, { method: 'PATCH', body: flags });
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
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Featured entries sort first on Explore. You can republish only what you unpublished, never an owner&apos;s draft; owners can still edit and republish their own entries.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <caption className="sr-only">Showcase entries</caption>
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="pb-2 pr-4">Project</th>
              <th className="pb-2 pr-4">Owner</th>
              <th className="pb-2 pr-4">State</th>
              <th className="pb-2 pr-4">Views</th>
              <th className="pb-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((s) => (
              <tr key={s.projectId} className="border-b align-top">
                <td className="py-3 pr-4">
                  <span className="inline-flex items-center gap-1 font-medium">
                    {s.featured && <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-500" aria-label="Featured" />}
                    {s.project.name}
                    {s.isPublished && (
                      <Link href={`/explore/${s.project.slug}`} target="_blank" className="text-muted-foreground hover:text-foreground" aria-label={`Open ${s.project.name} on Explore`}>
                        <ExternalLink className="w-3 h-3" />
                      </Link>
                    )}
                  </span>
                  <p className="mt-0.5 max-w-sm text-xs text-muted-foreground">{s.shortDescription}</p>
                </td>
                <td className="py-3 pr-4 text-xs text-muted-foreground">{s.project.user.email}</td>
                <td className="py-3 pr-4">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${s.isPublished ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : 'bg-muted text-muted-foreground'}`}>
                    {s.isPublished ? 'Published' : s.publishedAt ? 'Unpublished by admin' : 'Draft'}
                  </span>
                </td>
                <td className="py-3 pr-4 tabular-nums">{s.viewCount.toLocaleString()}</td>
                <td className="py-3">
                  <div className="flex items-center gap-2">
                    {acting === s.projectId && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
                    {(s.isPublished || s.publishedAt) && (
                      <button
                        type="button"
                        disabled={acting !== null}
                        onClick={() => {
                          if (s.isPublished && !confirm(`Unpublish "${s.project.name}" from Explore?`)) return;
                          void setFlags(s, { isPublished: !s.isPublished });
                        }}
                        className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                      >
                        {s.isPublished ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        {s.isPublished ? 'Unpublish' : 'Republish'}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={acting !== null}
                      onClick={() => void setFlags(s, { featured: !s.featured })}
                      className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                    >
                      <Star className="w-3.5 h-3.5" />
                      {s.featured ? 'Unfeature' : 'Feature'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-muted-foreground">No showcase entries.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
