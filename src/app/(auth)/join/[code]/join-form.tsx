'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface Preview {
  name: string;
  program: string;
  startsAt: string;
  endsAt: string;
}

const day = (iso: string): string => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

async function post(url: string, body: unknown): Promise<{ ok: boolean; message?: string }> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && json?.success !== false, message: json?.error?.message ?? json?.error };
}

export function JoinForm({ code }: { code: string }): React.ReactElement {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [signedInAs, setSignedInAs] = useState<string | null | undefined>(undefined);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/cohorts/join/${encodeURIComponent(code)}`)
      .then((r) => r.json())
      .then((body) => (body?.success ? setPreview(body.data) : setInvalid(body?.error?.message ?? 'This join link is invalid or no longer open')))
      .catch(() => setInvalid('Could not load this join link'));
    fetch('/api/auth/session')
      .then((r) => r.json())
      .then((body) => setSignedInAs(body?.data?.email ?? null))
      .catch(() => setSignedInAs(null));
  }, [code]);

  // Full page loads after joining: the dashboard menu must pick up the new batch.
  const joinAsCurrentUser = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const { ok, message } = await post('/api/cohorts/join', { code });
    if (ok) window.location.assign('/dashboard/batches');
    else {
      setError(message ?? 'Could not join the batch');
      setBusy(false);
    }
  };

  const signUpAndJoin = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { ok, message } = await post('/api/auth/register', { ...form, joinCode: code });
    if (ok) window.location.assign('/dashboard');
    else {
      setError(message ?? 'Could not create your account');
      setBusy(false);
    }
  };

  if (invalid) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-center">Can&apos;t use this link</CardTitle>
          <CardDescription className="text-center">{invalid}. Ask your mentor for a new one.</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  if (!preview || signedInAs === undefined) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-center">Join {preview.name}</CardTitle>
        <CardDescription className="text-center">
          {preview.program} · {day(preview.startsAt)} – {day(preview.endsAt)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {signedInAs ? (
          <>
            <p className="text-sm text-muted-foreground text-center">Signed in as {signedInAs}</p>
            <Button className="w-full" disabled={busy} onClick={() => void joinAsCurrentUser()}>
              {busy ? 'Joining…' : 'Join this batch'}
            </Button>
          </>
        ) : (
          <form onSubmit={(e) => void signUpAndJoin(e)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="join-name">Your name</Label>
              <Input id="join-name" autoComplete="name" required maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="join-email">Email</Label>
              <Input id="join-email" type="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="join-password">Password</Label>
              <Input id="join-password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? 'Creating your account…' : 'Create account and join'}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Already have an account?{' '}
              <Link href={`/login?from=${encodeURIComponent(`/join/${code}`)}`} className="underline underline-offset-4">
                Log in
              </Link>
            </p>
          </form>
        )}
        {error && <p className="text-sm text-destructive text-center" role="alert">{error}</p>}
      </CardContent>
    </Card>
  );
}
