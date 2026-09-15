'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { DomainStatus, DomainView, DnsInstruction } from '@/types/domain.types';
import {
  Plus,
  Trash2,
  Loader2,
  Check,
  Copy,
  Globe,
  RefreshCw,
  Star,
  AlertTriangle,
  ArrowUpRight,
  HelpCircle,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Setup is a task, not a list
//
// Someone adding a custom domain is doing something they have never done before
// and will likely never do again. They are not "managing domains" — they are
// trying to finish one job, in a registrar's admin panel, in another tab.
// Everything here is shaped around that:
//
//   · the DNS record is the hero, laid out the way registrar forms are laid out
//   · the relative host name comes first, because pasting the full one is the
//     commonest way this fails (it silently creates host.example.com.example.com)
//   · every state names the next action, and says who has to take it — which,
//     after the worker started triggering issuance itself, is nobody past the
//     DNS step
// ---------------------------------------------------------------------------

/** Statuses that are still moving — the panel polls while any domain is in one. */
const IN_FLIGHT: DomainStatus[] = ['PENDING_DNS', 'VERIFYING', 'VERIFIED', 'PROVISIONING'];

const POLL_INTERVAL_MS = 15_000;
const CLOCK_TICK_MS = 5_000;
const COPIED_FEEDBACK_MS = 1500;

const STEPS = ['Add DNS records', 'We confirm them', 'We secure it'] as const;

/**
 * Which step the user is on. `STEPS.length` means finished.
 *
 * `VERIFIED` sits on step 2 rather than step 1: ownership is proven, so the
 * records are partly in place, but traffic still is not reaching us.
 */
function stepOf(status: DomainStatus): number {
  if (status === 'ACTIVE') return STEPS.length;
  if (status === 'PROVISIONING') return 2;
  if (status === 'VERIFIED') return 1;
  return 0;
}

interface StatusCopy {
  label: string;
  /** What is happening, in the user's terms. */
  detail: string;
  tone: 'idle' | 'progress' | 'good' | 'bad';
}

function statusCopy(domain: DomainView): StatusCopy {
  switch (domain.status) {
    case 'PENDING_DNS':
      return {
        label: 'Waiting for your DNS records',
        detail:
          'Add the two records below at whoever manages your domain. We re-check every couple of minutes, so you can close this page.',
        tone: 'idle',
      };
    case 'VERIFYING':
      return { label: 'Checking your DNS', detail: 'Reading the records now.', tone: 'progress' };
    case 'VERIFIED':
      return {
        label: 'Ownership confirmed',
        detail: `We found your TXT record. Now add the ${domain.isApex ? 'A' : 'CNAME'} record so visitors reach us.`,
        tone: 'progress',
      };
    case 'PROVISIONING':
      return {
        label: 'Getting its certificate',
        detail:
          'DNS is correct, and we are requesting the certificate now. This usually finishes within a couple of minutes — nothing for you to do.',
        tone: 'progress',
      };
    case 'ACTIVE':
      return { label: 'Live', detail: 'Serving over HTTPS. The certificate renews on its own.', tone: 'good' };
    case 'FAILED':
      return { label: 'Needs a fix', detail: 'Something in DNS is not right yet.', tone: 'bad' };
  }
}

const TONE_CLASS: Record<StatusCopy['tone'], string> = {
  idle: 'text-muted-foreground',
  progress: 'text-amber-600 dark:text-amber-400',
  good: 'text-emerald-600 dark:text-emerald-400',
  bad: 'text-destructive',
};

/** "2 minutes ago" — coarse on purpose; precision here would be noise. */
function timeAgo(iso: string | null, now: number): string | null {
  if (!iso) return null;
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'} ago`;
}

/** Ticks so relative timestamps stay honest without a re-fetch. */
function useClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

// ---------------------------------------------------------------------------
// CopyValue — a value you are meant to paste somewhere else
// ---------------------------------------------------------------------------

function CopyValue({
  label,
  value,
  hint,
  emphasis = false,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
}): React.ReactElement {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    return () => clearTimeout(id);
  }, [copied]);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // No clipboard outside a secure context. The value is selectable on
      // screen, so there is nothing useful to report here.
    }
  };

  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        {hint && <span className="text-[11px] text-muted-foreground/70">{hint}</span>}
      </div>
      <button
        type="button"
        onClick={copy}
        title={`Copy ${label.toLowerCase()}`}
        className={cn(
          'group mt-1 flex w-full items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5 text-left',
          'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          emphasis && 'border-foreground/20',
        )}
      >
        <code
          className={cn(
            'min-w-0 flex-1 truncate font-mono text-[13px]',
            emphasis ? 'font-semibold' : 'font-medium',
          )}
        >
          {value}
        </code>
        {copied ? (
          <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <Copy className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60 group-hover:text-foreground" />
        )}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RecordCard — laid out like the form the user is copying into
// ---------------------------------------------------------------------------

function RecordCard({ record, index }: { record: DnsInstruction; index: number }): React.ReactElement {
  const isRoot = record.host === '@';

  return (
    <div className="rounded-lg border p-3 sm:p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-[11px] font-semibold">
          {index + 1}
        </span>
        <span className="text-sm font-medium">
          {record.kind === 'TXT' ? 'Prove you own it' : 'Send visitors to us'}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
        <div className="sm:w-20">
          <span className="text-xs text-muted-foreground">Type</span>
          <div className="mt-1 flex h-[34px] items-center">
            <Badge variant="outline" className="font-mono text-[11px]">
              {record.kind}
            </Badge>
          </div>
        </div>

        <CopyValue
          label="Host"
          hint={isRoot ? 'the domain root' : `= ${record.name}`}
          value={record.host}
          emphasis
        />
      </div>

      <div className="mt-3">
        <CopyValue label={record.kind === 'TXT' ? 'Value' : 'Points to'} value={record.value} />
      </div>

      {record.note && <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">{record.note}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

function Steps({ current }: { current: number }): React.ReactElement {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      {STEPS.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={step} className="flex items-center gap-2">
            <span
              className={cn(
                'flex items-center gap-1.5',
                done && 'text-emerald-600 dark:text-emerald-400',
                active && 'font-medium text-foreground',
                !done && !active && 'text-muted-foreground/60',
              )}
            >
              {done ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <span
                  className={cn(
                    'flex h-3.5 w-3.5 items-center justify-center rounded-full border text-[9px]',
                    active ? 'border-foreground' : 'border-muted-foreground/40',
                  )}
                >
                  {i + 1}
                </span>
              )}
              {step}
            </span>
            {i < STEPS.length - 1 && <span className="text-muted-foreground/30">›</span>}
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// DomainCard
// ---------------------------------------------------------------------------

function DomainCard({
  domain,
  projectId,
  onChanged,
}: {
  domain: DomainView;
  projectId: string;
  onChanged: () => void;
}): React.ReactElement {
  const [busy, setBusy] = useState<'verify' | 'primary' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [showRecords, setShowRecords] = useState(false);

  const isLive = domain.status === 'ACTIVE';
  const settling = IN_FLIGHT.includes(domain.status);
  const now = useClock(settling);
  const copy = statusCopy(domain);
  const step = stepOf(domain.status);
  const checked = timeAgo(domain.lastCheckedAt, now);

  // Records stay open through the whole setup, because that is the work. Once
  // the domain is live they are just clutter, so they collapse away.
  const recordsOpen = isLive ? showRecords : !showRecords;

  const base = `/api/projects/${projectId}/domains/${domain.id}`;

  const call = async (
    action: 'verify' | 'primary' | 'delete',
    request: () => Promise<Response>,
  ): Promise<void> => {
    setBusy(action);
    setError(null);
    try {
      const res = await request();
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error?.message ?? 'That did not work. Try again in a moment.');
      } else {
        setConfirmingDelete(false);
        onChanged();
      }
    } catch {
      setError('Could not reach DropDeploy. Check your connection and try again.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-lg border">
      {/* Identity + status */}
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate font-mono text-sm font-medium">{domain.hostname}</span>
              {domain.isPrimary && (
                <Badge variant="outline" className="shrink-0 gap-1 text-[10px]">
                  <Star className="h-2.5 w-2.5" />
                  Primary
                </Badge>
              )}
            </div>
            <div className={cn('flex items-center gap-1.5 text-xs font-medium', TONE_CLASS[copy.tone])}>
              {copy.tone === 'progress' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {copy.tone === 'good' && <Check className="h-3.5 w-3.5" />}
              {copy.tone === 'bad' && <AlertTriangle className="h-3.5 w-3.5" />}
              {copy.label}
            </div>
          </div>

          {isLive && (
            <Button variant="outline" size="sm" className="shrink-0 gap-1.5" asChild>
              <a href={`https://${domain.hostname}`} target="_blank" rel="noreferrer noopener">
                Visit
                <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
            </Button>
          )}
        </div>

        {!isLive && <Steps current={step} />}

        {/* The service's message names the exact record that is missing, so it
            wins over the generic status copy whenever it is present. */}
        <p className="text-xs leading-relaxed text-muted-foreground">{domain.lastError ?? copy.detail}</p>

        {/* The background worker now makes the request that triggers issuance,
            so this is a shortcut rather than a requirement — secondary styling,
            and copy that offers rather than instructs. */}
        {domain.status === 'PROVISIONING' && (
          <Button variant="outline" size="sm" className="gap-1.5" asChild>
            <a href={`https://${domain.hostname}`} target="_blank" rel="noreferrer noopener">
              Open it now instead of waiting
              <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          </Button>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>

      {/* Records */}
      {(recordsOpen || !isLive) && (
        <div className="border-t bg-muted/20 p-4">
          {!isLive && (
            <div className="mb-3 flex items-start gap-2">
              <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <p className="text-xs leading-relaxed text-muted-foreground">
                Add these at whoever manages <span className="font-medium">{domain.dnsRecords[0]?.zone}</span> —
                your registrar or DNS provider. Most ask for <span className="font-medium">Host</span> without the
                domain on the end, which is what we show below.
              </p>
            </div>
          )}

          {recordsOpen && (
            <div className="space-y-2.5">
              {domain.dnsRecords.map((record, i) => (
                <RecordCard key={`${record.kind}-${record.name}`} record={record} index={i} />
              ))}
            </div>
          )}

          {isLive && (
            <button
              type="button"
              onClick={() => setShowRecords((open) => !open)}
              className="text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              {showRecords ? 'Hide DNS records' : 'Show DNS records'}
            </button>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2.5">
        <span className="text-[11px] text-muted-foreground">
          {settling
            ? checked
              ? `Checked ${checked} · we keep checking automatically`
              : 'Checking automatically'
            : checked
              ? `Checked ${checked}`
              : ''}
        </span>

        <div className="flex items-center gap-1">
          {!isLive && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              disabled={busy !== null}
              onClick={() => call('verify', () => fetch(`${base}/verify`, { method: 'POST' }))}
            >
              {busy === 'verify' ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              Check now
            </Button>
          )}

          {isLive && !domain.isPrimary && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              disabled={busy !== null}
              onClick={() =>
                call('primary', () =>
                  fetch(base, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ isPrimary: true }),
                  }),
                )
              }
            >
              {busy === 'primary' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Star className="h-3 w-3" />}
              Make primary
            </Button>
          )}

          {confirmingDelete ? (
            <span className="flex items-center gap-1">
              <span className="text-[11px] text-muted-foreground">Remove it?</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-destructive hover:text-destructive"
                disabled={busy !== null}
                onClick={() => call('delete', () => fetch(base, { method: 'DELETE' }))}
              >
                {busy === 'delete' ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Yes, remove'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setConfirmingDelete(false)}
              >
                Keep
              </Button>
            </span>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs text-destructive hover:text-destructive"
              disabled={busy !== null}
              onClick={() => setConfirmingDelete(true)}
            >
              <Trash2 className="h-3 w-3" />
              Remove
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AddDomainForm
// ---------------------------------------------------------------------------

function AddDomainForm({
  projectId,
  hasDomains,
  onCreated,
}: {
  projectId: string;
  hasDomains: boolean;
  onCreated: () => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [hostname, setHostname] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!hostname.trim()) return;

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/domains`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostname: hostname.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error?.message ?? 'That domain could not be added.');
      } else {
        setHostname('');
        setOpen(false);
        onCreated();
      }
    } catch {
      setError('Could not reach DropDeploy. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <Button
        variant={hasDomains ? 'outline' : 'default'}
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-1.5"
      >
        <Plus className="h-3.5 w-3.5" />
        Add a domain
      </Button>
    );
  }

  return (
    <div className="rounded-lg border p-4">
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="domain-hostname" className="text-xs">
            Your domain
          </Label>
          <Input
            id="domain-hostname"
            value={hostname}
            onChange={(e) => setHostname(e.target.value)}
            placeholder="app.yourdomain.com"
            className="h-9 font-mono text-sm"
            autoFocus
            required
          />
          <p className="text-xs text-muted-foreground">
            A domain you already own. Next we&apos;ll show you the two records to add at your DNS provider.
          </p>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" disabled={saving || !hostname.trim()}>
            {saving ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Adding…
              </>
            ) : (
              'Continue'
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setOpen(false);
              setHostname('');
              setError(null);
            }}
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DomainsPanel
// ---------------------------------------------------------------------------

export function DomainsPanel({ projectId }: { projectId: string }): React.ReactElement {
  const [domains, setDomains] = useState<DomainView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDomains = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      setError(null);
      try {
        const res = await fetch(`/api/projects/${projectId}/domains`, { signal });
        const data = await res.json();
        if (data?.success && data.data) {
          setDomains(data.data);
        } else {
          setError(data?.error?.message ?? 'Could not load your domains.');
        }
      } catch (err) {
        // An abort is this component unmounting or re-fetching, not a failure —
        // reporting it would flash an error on the way out.
        if ((err as Error)?.name === 'AbortError') return;
        setError('Could not load your domains.');
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void fetchDomains(controller.signal);
    return () => controller.abort();
  }, [fetchDomains]);

  // Derived during render, which is what keeps the effect below off the
  // `domains` array, whose identity changes on every poll.
  const isSettling = domains.some((domain) => IN_FLIGHT.includes(domain.status));

  useEffect(() => {
    if (!isSettling) return;
    const controller = new AbortController();
    const id = setInterval(() => void fetchDomains(controller.signal), POLL_INTERVAL_MS);
    return () => {
      clearInterval(id);
      controller.abort();
    };
  }, [isSettling, fetchDomains]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Custom domains</CardTitle>
        <CardDescription>
          Serve this project from a domain you own instead of its DropDeploy address. You add two DNS
          records; we handle the HTTPS certificate and keep it renewed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="space-y-2 py-4">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={() => void fetchDomains()}>
              Try again
            </Button>
          </div>
        ) : domains.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Globe className="mb-2 h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm font-medium">No custom domain yet</p>
            <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
              Right now this project is reachable at its DropDeploy address. Add a domain you own and
              we&apos;ll walk you through the DNS.
            </p>
            <div className="mt-4">
              <AddDomainForm projectId={projectId} hasDomains={false} onCreated={() => void fetchDomains()} />
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {domains.map((domain) => (
                <DomainCard
                  key={domain.id}
                  domain={domain}
                  projectId={projectId}
                  onChanged={() => void fetchDomains()}
                />
              ))}
            </div>
            <div className="pt-1">
              <AddDomainForm
                projectId={projectId}
                hasDomains
                onCreated={() => void fetchDomains()}
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
