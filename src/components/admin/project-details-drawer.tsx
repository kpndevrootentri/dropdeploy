'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { adminRequest } from '@/components/admin/admin-request';
import { cn, formatBytes } from '@/lib/utils';

interface Details {
  envKeys: { key: string; environment: string }[];
  access: { id: string; kind: 'USER' | 'DOMAIN'; email: string | null; domain: string | null }[];
  domains: { id: string; hostname: string; status: string; isPrimary: boolean }[];
  usage: { cpuPercent: number; memoryUsedBytes: number; memoryLimitBytes: number } | null;
  usageError: string | null;
  allowRepoDockerfile: boolean;
}

function Section({ title, empty, children }: { title: string; empty: boolean; children: React.ReactNode }): React.ReactElement {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {empty ? <p className="text-xs text-muted-foreground">None.</p> : children}
    </section>
  );
}

/** Read-mostly view of one project for admins. Deployments and logs live in the Projects row. */
export function ProjectDetailsDrawer({
  project,
  onClose,
}: {
  project: { id: string; name: string; source: string; user: { email: string } } | null;
  onClose: () => void;
}): React.ReactElement {
  const [details, setDetails] = useState<Details | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [savingDockerfile, setSavingDockerfile] = useState(false);
  const projectId = project?.id;

  const load = useCallback(() => {
    if (!projectId) return;
    adminRequest<Details>(`/api/admin/projects/${projectId}/details`)
      .then((d) => { setDetails(d); setError(null); })
      .catch((e: Error) => setError(e.message));
  }, [projectId]);

  // The page keys this component by project id, so a new project mounts fresh
  // state and a slower response for the previous one lands on an unmounted instance.
  useEffect(() => { load(); }, [load]);

  const revoke = async (accessId: string, label: string): Promise<void> => {
    if (!projectId || !confirm(`Remove ${label}'s access to "${project?.name}"?`)) return;
    setRevoking(accessId);
    try {
      await adminRequest(`/api/admin/projects/${projectId}/access/${accessId}`, { method: 'DELETE' });
      toast.success(`Removed ${label}`);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRevoking(null);
    }
  };

  const setRepoDockerfile = async (allowed: boolean): Promise<void> => {
    if (!projectId) return;
    setSavingDockerfile(true);
    try {
      await adminRequest(`/api/admin/projects/${projectId}/dockerfile`, { method: 'PATCH', body: { allowed } });
      setDetails((d) => d && { ...d, allowRepoDockerfile: allowed });
      toast.success(allowed ? "The next deploy builds from the repository's Dockerfile" : 'The next deploy uses the generated Dockerfile');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSavingDockerfile(false);
    }
  };

  const usage = details?.usage;
  const memPct = usage && usage.memoryLimitBytes > 0 ? Math.round((usage.memoryUsedBytes / usage.memoryLimitBytes) * 100) : null;

  return (
    <Dialog open={project !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{project?.name}</DialogTitle>
          <DialogDescription>Owned by {project?.user.email}</DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="py-4 text-sm text-destructive" role="alert">{error}</p>
        ) : !details ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="space-y-5 pt-2">
            <Section title="Container usage" empty={false}>
              {usage ? (
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">CPU</p>
                    <p className="font-semibold tabular-nums">{usage.cpuPercent.toFixed(1)}%</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Memory</p>
                    <p className="font-semibold tabular-nums">
                      {formatBytes(usage.memoryUsedBytes)} / {usage.memoryLimitBytes > 0 ? formatBytes(usage.memoryLimitBytes) : 'no limit'}
                      {memPct !== null && <span className="ml-1 text-xs font-normal text-muted-foreground">({memPct}%)</span>}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">{details.usageError ?? 'No running container.'}</p>
              )}
            </Section>

            {/* Uploads are never built with Docker. */}
            {project?.source !== 'UPLOAD' && (
              <Section title="Build" empty={false}>
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <p id="repo-dockerfile-label" className="text-sm">Use the repository&apos;s Dockerfile</p>
                    <p className="text-xs text-muted-foreground">
                      From the next deploy. The owner&apos;s own build steps run on the build server, so turn it on only for owners you trust.
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={details.allowRepoDockerfile}
                    aria-labelledby="repo-dockerfile-label"
                    disabled={savingDockerfile}
                    onClick={() => void setRepoDockerfile(!details.allowRepoDockerfile)}
                    className={cn(
                      'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
                      details.allowRepoDockerfile ? 'bg-primary' : 'bg-input',
                    )}
                  >
                    <span
                      className={cn(
                        'pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform',
                        details.allowRepoDockerfile ? 'translate-x-5' : 'translate-x-0',
                      )}
                    />
                  </button>
                </div>
              </Section>
            )}

            <Section title="Environment variables" empty={details.envKeys.length === 0}>
              <p className="text-xs text-muted-foreground">Names only; values stay encrypted on the server.</p>
              <ul className="flex flex-wrap gap-1.5">
                {details.envKeys.map((v) => (
                  <li key={`${v.key}:${v.environment}`} className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                    {v.key}
                    <span className="ml-1 text-[10px] text-muted-foreground">{v.environment.toLowerCase()}</span>
                  </li>
                ))}
              </ul>
            </Section>

            <Section title="Collaborators" empty={details.access.length === 0}>
              <ul className="divide-y text-sm">
                {details.access.map((a) => {
                  const label = a.kind === 'USER' ? a.email ?? 'unknown user' : `anyone @${a.domain}`;
                  return (
                    <li key={a.id} className="flex items-center justify-between py-1.5">
                      <span>{label}</span>
                      <button
                        type="button"
                        disabled={revoking !== null}
                        onClick={() => void revoke(a.id, label)}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950 dark:hover:text-red-400 disabled:opacity-30"
                      >
                        {revoking === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        Remove
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Section>

            <Section title="Custom domains" empty={details.domains.length === 0}>
              <ul className="space-y-1 text-sm">
                {details.domains.map((d) => (
                  <li key={d.id} className="flex items-center justify-between">
                    <span>{d.hostname}{d.isPrimary && <span className="ml-1 text-xs text-muted-foreground">(primary)</span>}</span>
                    <span className="text-xs text-muted-foreground">{d.status}</span>
                  </li>
                ))}
              </ul>
            </Section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
