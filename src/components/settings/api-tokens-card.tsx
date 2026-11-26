'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { CopyValue } from '@/components/ui/copy-value';
import { AlertCircle, Download, KeySquare, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type Scope = 'DEPLOY' | 'FULL';

interface TokenView {
  id: string;
  name: string;
  prefix: string;
  scope: Scope;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

const SCOPES: { value: Scope; label: string; hint: string }[] = [
  {
    value: 'DEPLOY',
    label: 'Deploy only (recommended)',
    hint: 'Upload new sites, redeploy existing projects, and read their deployments and logs. Nothing else.',
  },
  {
    value: 'FULL',
    label: 'Full access',
    hint: 'Also create projects from any repository your linked GitHub or GitLab account can read, and manage env vars, domains, access and project settings. Account settings stay dashboard-only.',
  },
];

const EXPIRY_OPTIONS = [
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '365 days' },
  { value: 'never', label: 'No expiry' },
];

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function ApiTokensCard(): React.ReactElement {
  const [tokens, setTokens] = useState<TokenView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [scope, setScope] = useState<Scope>('DEPLOY');
  const [expiry, setExpiry] = useState('90');
  const [password, setPassword] = useState('');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<string | null>(null);

  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/tokens');
      const data = await res.json().catch(() => null);
      if (res.ok) setTokens(data?.data?.tokens ?? []);
      else setError(data?.error?.message ?? 'Could not load your API tokens');
    } catch {
      setError('Could not reach Entrify. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const res = await fetch('/api/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, scope, expiresInDays: expiry === 'never' ? null : Number(expiry), password }),
      });
      const data = await res.json().catch(() => null);
      setPassword('');
      if (!res.ok) {
        setError(data?.error?.message ?? 'Could not create the token');
      } else {
        setCreated(data.data.token);
        setName('');
        void load();
      }
    } catch {
      setError('Could not reach Entrify. Check your connection and try again.');
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string): Promise<void> => {
    setError(null);
    setRevokingId(id);
    try {
      const res = await fetch(`/api/tokens/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error?.message ?? 'Could not revoke the token');
      } else {
        setConfirmingId(null);
        void load();
      }
    } catch {
      setError('Could not reach Entrify. Check your connection and try again.');
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <Card id="api-tokens" className="scroll-mt-20">
      <CardHeader>
        <div className="flex items-center gap-2">
          <KeySquare className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">API Tokens</CardTitle>
        </div>
        <CardDescription>
          Tokens let the Claude Desktop extension, CI jobs and the CLI (as <code>ENTRIFY_TOKEN</code>) deploy for
          you without signing in.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {error && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {created ? (
          <div role="status" className="space-y-3 rounded-lg border border-green-500/30 bg-green-500/10 p-3">
            <CopyValue label="Your new token" hint="Copy it now. It will not be shown again." value={created} emphasis />
            <div className="space-y-2 text-sm">
              <p className="font-medium">Next steps</p>
              <div className="space-y-1">
                <p>
                  <span className="font-medium">Claude Desktop:</span> install the extension and paste the token when it
                  asks. To change it later, click Entrify in Claude Desktop&apos;s extension settings.
                </p>
                <a
                  href="/downloads/entrify.mcpb"
                  download
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-primary underline-offset-4 hover:underline"
                >
                  <Download className="h-3 w-3" />
                  Download the Entrify extension for Claude Desktop
                </a>
              </div>
              <CopyValue label="Terminal / CI" value={`export ENTRIFY_TOKEN=${created}`} />
            </div>
            <Button type="button" size="sm" variant="outline" onClick={() => setCreated(null)}>
              Done, I saved it
            </Button>
          </div>
        ) : (
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="api-token-name" className="text-xs text-muted-foreground">
                Name
              </Label>
              <Input
                id="api-token-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Claude Desktop on my laptop"
                maxLength={60}
                autoComplete="off"
                required
              />
            </div>

            <fieldset className="space-y-2">
              <legend className="text-xs text-muted-foreground">Access</legend>
              {SCOPES.map((s) => (
                <label
                  key={s.value}
                  className={cn(
                    'flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2',
                    scope === s.value && 'border-foreground/30 bg-muted/40',
                  )}
                >
                  <input
                    type="radio"
                    name="api-token-scope"
                    value={s.value}
                    checked={scope === s.value}
                    onChange={() => setScope(s.value)}
                    className="mt-1"
                  />
                  <span>
                    <span className="block text-sm font-medium">{s.label}</span>
                    <span className="block text-xs text-muted-foreground">{s.hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            <div className="space-y-1.5">
              <Label htmlFor="api-token-expiry" className="text-xs text-muted-foreground">
                Expires after
              </Label>
              <select
                id="api-token-expiry"
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
                className={cn(
                  'flex h-9 w-full max-w-[220px] rounded-md border border-input bg-background px-3 text-sm',
                  'ring-offset-background focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                )}
              >
                {EXPIRY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="api-token-password" className="text-xs text-muted-foreground">
                Your password
              </Label>
              <Input
                id="api-token-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                aria-describedby="api-token-password-hint"
                className="max-w-[320px]"
                required
              />
              <p id="api-token-password-hint" className="text-xs text-muted-foreground">
                Asked again because a token can outlast this sign-in.
              </p>
            </div>

            <Button type="submit" size="sm" disabled={creating || !name.trim() || !password}>
              {creating ? 'Creating…' : 'Create token'}
            </Button>
          </form>
        )}

        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Your tokens</p>
          {loading ? (
            <div className="h-12 rounded-md bg-muted animate-pulse" />
          ) : tokens.length === 0 ? (
            <p className="text-sm text-muted-foreground">No API tokens yet.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {tokens.map((t) => {
                const expired = t.expiresAt !== null && new Date(t.expiresAt) <= new Date();
                const inactive = t.revokedAt !== null || expired;
                return (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                    <div className={cn('min-w-0 space-y-0.5', inactive && 'opacity-60')}>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-sm font-medium">{t.name}</span>
                        <Badge variant="secondary" className="text-[10px]">
                          {t.scope === 'FULL' ? 'Full access' : 'Deploy only'}
                        </Badge>
                        {t.revokedAt ? (
                          <Badge variant="outline" className="text-[10px]">Revoked</Badge>
                        ) : expired ? (
                          <Badge variant="outline" className="text-[10px]">Expired</Badge>
                        ) : null}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        <code className="font-mono">{t.prefix}…</code>
                        {' · '}Created {formatDate(t.createdAt)}
                        {' · '}Last used {t.lastUsedAt ? formatDate(t.lastUsedAt) : 'never'}
                        {' · '}
                        {t.expiresAt ? `${expired ? 'Expired' : 'Expires'} ${formatDate(t.expiresAt)}` : 'Never expires'}
                      </p>
                    </div>
                    {!t.revokedAt &&
                      (confirmingId === t.id ? (
                        <span className="flex items-center gap-1">
                          <span className="text-[11px] text-muted-foreground">Revoke it?</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-destructive hover:text-destructive"
                            disabled={revokingId !== null}
                            aria-label={revokingId === t.id ? 'Revoking' : undefined}
                            onClick={() => void handleRevoke(t.id)}
                          >
                            {revokingId === t.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Yes, revoke'}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            // The Revoke button that had focus is gone; land on the safe choice.
                            autoFocus
                            onClick={() => setConfirmingId(null)}
                          >
                            Keep
                          </Button>
                        </span>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-destructive hover:text-destructive"
                          aria-label={`Revoke ${t.name}`}
                          onClick={() => setConfirmingId(t.id)}
                        >
                          Revoke
                        </Button>
                      ))}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
