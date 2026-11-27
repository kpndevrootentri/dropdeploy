'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { CopyValue } from '@/components/ui/copy-value';
import { Bell, Loader2, Plus, Trash2 } from 'lucide-react';

interface Hook {
  id: string;
  host: string;
  kind: 'slack' | 'discord' | 'generic';
  events: string[];
  lastStatus: string | null;
  lastAttemptAt: string | null;
}

const EVENTS = [
  { value: 'deployment.succeeded', label: 'Deploy succeeded' },
  { value: 'deployment.failed', label: 'Deploy failed' },
] as const;

const KIND_LABEL: Record<Hook['kind'], string> = { slack: 'Slack', discord: 'Discord', generic: 'Webhook' };

function statusText(hook: Hook): string {
  if (!hook.lastStatus || !hook.lastAttemptAt) return 'Nothing sent yet';
  const when = new Date(hook.lastAttemptAt).toLocaleString();
  return /^2\d\d$/.test(hook.lastStatus)
    ? `Delivered (${hook.lastStatus}) ${when}`
    : `Last delivery failed (${hook.lastStatus}) ${when}`;
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => null);
  return data?.error?.message ?? fallback;
}

export function NotificationsPanel({ projectId }: { projectId: string }): React.ReactElement {
  const [hooks, setHooks] = useState<Hook[] | null>(null);
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>(EVENTS.map((e) => e.value));
  const [saving, setSaving] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchHooks = useCallback(() => {
    fetch(`/api/projects/${projectId}/notifications`)
      .then(async (res) => {
        if (!res.ok) throw new Error(await errorMessage(res, 'Failed to load notifications'));
        setHooks((await res.json()).data);
      })
      .catch((err: Error) => setError(err.message));
  }, [projectId]);

  useEffect(() => {
    fetchHooks();
  }, [fetchHooks]);

  const handleAdd = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/notifications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), events }),
      });
      if (!res.ok) {
        setError(await errorMessage(res, 'Failed to add'));
        return;
      }
      setSecret((await res.json()).data.secret);
      setUrl('');
      fetchHooks();
    } catch {
      setError('Something went wrong');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (hookId: string): Promise<void> => {
    setError(null);
    const res = await fetch(`/api/projects/${projectId}/notifications/${hookId}`, { method: 'DELETE' }).catch(() => null);
    if (!res?.ok) setError(res ? await errorMessage(res, 'Failed to remove') : 'Something went wrong');
    fetchHooks();
  };

  const toggleEvent = (value: string): void =>
    setEvents((current) => (current.includes(value) ? current.filter((v) => v !== value) : [...current, value]));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Notifications</CardTitle>
        <CardDescription>
          Post to Slack, Discord or any HTTPS URL when a deployment succeeds or fails. Up to 3 per project.{' '}
          <Link href="/docs/notifications" className="underline underline-offset-4">How it works</Link>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

        {hooks === null ? (
          // A failed load shows its error above instead of a spinner that never stops.
          !error && (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )
        ) : hooks.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Bell className="h-4 w-4" /> No notifications yet.
          </div>
        ) : (
          <ul className="space-y-2">
            {hooks.map((hook) => (
              <li key={hook.id} className="flex items-center gap-3 rounded-lg border px-4 py-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <code className="truncate font-mono text-sm font-medium">{hook.host}</code>
                    <Badge variant="outline" className="shrink-0 text-xs">{KIND_LABEL[hook.kind]}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {EVENTS.filter((e) => hook.events.includes(e.value)).map((e) => e.label).join(', ')} · {statusText(hook)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
                  onClick={() => { void handleDelete(hook.id); }}
                  title="Remove notification"
                  aria-label={`Remove notification to ${hook.host}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        {secret ? (
          <div role="status" className="space-y-3 rounded-lg border border-green-500/30 bg-green-500/10 p-3">
            <CopyValue label="Signing secret" hint="Copy it now. It will not be shown again." value={secret} emphasis />
            <p className="text-xs text-muted-foreground">
              Every request carries an X-Entrify-Signature made with this secret, so your server can check it came
              from Entrify. Slack and Discord ignore it. A test message is on its way.
            </p>
            <Button type="button" size="sm" variant="outline" onClick={() => { setSecret(null); fetchHooks(); }}>
              Done
            </Button>
          </div>
        ) : (
          <form onSubmit={handleAdd} className="space-y-3 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="notification-url" className="text-xs">Webhook URL</Label>
              <Input
                id="notification-url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://hooks.slack.com/services/…"
                className="h-8 font-mono text-sm"
                required
              />
            </div>
            <div className="flex flex-wrap gap-4">
              {EVENTS.map((e) => (
                <label key={e.value} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={events.includes(e.value)} onChange={() => toggleEvent(e.value)} />
                  {e.label}
                </label>
              ))}
            </div>
            <Button type="submit" size="sm" variant="outline" className="gap-1.5" disabled={saving || !url.trim() || events.length === 0}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Add notification
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
