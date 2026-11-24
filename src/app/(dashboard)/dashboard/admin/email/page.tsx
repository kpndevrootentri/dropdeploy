'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, RefreshCw, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { adminRequest } from '@/components/admin/admin-request';
import type { EmailUsage } from '@/services/email';
import type { SesAccount } from '@/lib/email';

/** The platform settings this page edits; 0 means no limit. */
const QUOTA_FIELDS = [
  { key: 'emailDailyLimit', label: 'Emails a day' },
  { key: 'emailMonthlyLimit', label: 'Emails a month' },
  { key: 'resetEmailsPerDay', label: 'Forgot-password emails a day' },
] as const;
type QuotaKey = (typeof QUOTA_FIELDS)[number]['key'];

function quotasOf(usage: EmailUsage): Record<QuotaKey, number> {
  return {
    emailDailyLimit: usage.sent.dailyLimit,
    emailMonthlyLimit: usage.sent.monthlyLimit,
    resetEmailsPerDay: usage.resets.dailyLimit,
  };
}

/** Number inputs are edited as text so a half-typed value is not coerced to 0. */
function toForm(usage: EmailUsage): Record<QuotaKey, string> {
  const quotas = quotasOf(usage);
  return Object.fromEntries(QUOTA_FIELDS.map(({ key }) => [key, String(quotas[key])])) as Record<QuotaKey, string>;
}

const fetchUsage = (): Promise<EmailUsage> => adminRequest<EmailUsage>('/api/admin/email');

function UsageBar({ label, used, limit }: { label: string; used: number; limit: number }): React.ReactElement {
  const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const color = percent >= 100 ? 'bg-destructive' : percent >= 80 ? 'bg-amber-500' : 'bg-primary';
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums">
          {used.toLocaleString()} / {limit > 0 ? limit.toLocaleString() : 'no limit'}
        </span>
      </div>
      {limit > 0 && (
        <div
          className="h-2 rounded-full bg-muted"
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-valuenow={used}
        >
          <div className={`h-2 rounded-full ${color}`} style={{ width: `${percent}%` }} />
        </div>
      )}
    </div>
  );
}

function SesAccountDetails({ account }: { account: SesAccount }): React.ReactElement {
  const facts = [
    {
      label: 'Production access',
      value: account.productionAccess ? 'Yes' : 'No: sandbox, only verified addresses',
      warn: !account.productionAccess,
    },
    { label: 'Sending', value: account.sendingEnabled ? 'Enabled' : 'Paused by AWS', warn: !account.sendingEnabled },
    {
      label: 'Reputation',
      value: account.enforcementStatus ?? 'Unknown',
      warn: account.enforcementStatus !== 'HEALTHY',
    },
  ];
  return (
    <>
      <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
        {facts.map(({ label, value, warn }) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className={warn ? 'font-medium text-destructive' : 'font-medium'}>{value}</dd>
          </div>
        ))}
      </dl>
      <UsageBar label="Sent in the last 24 hours" used={account.sentLast24Hours} limit={account.max24HourSend} />
      <p className="text-xs text-muted-foreground">Up to {account.maxSendRatePerSecond} emails a second.</p>
    </>
  );
}

export default function AdminEmailPage(): React.ReactElement {
  const [usage, setUsage] = useState<EmailUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Record<QuotaKey, string> | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    fetchUsage()
      .then((next) => {
        setUsage(next);
        setForm(toForm(next));
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  /** Reloads the numbers; the quota form is only reset when asked, so a refresh keeps unsaved edits. */
  const load = async (resetForm: boolean): Promise<void> => {
    try {
      const next = await fetchUsage();
      setUsage(next);
      if (resetForm) setForm(toForm(next));
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const save = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!usage || !form) return;
    const current = quotasOf(usage);
    // Only the fields changed here, so another admin's concurrent change to a different setting survives.
    const body = Object.fromEntries(
      QUOTA_FIELDS.map(({ key }) => [key, Number(form[key])] as const).filter(([key, value]) => value !== current[key]),
    );
    if (Object.keys(body).length === 0) {
      toast.info('No changes to save');
      return;
    }
    setSaving(true);
    try {
      await adminRequest('/api/admin/settings', { method: 'PATCH', body });
      toast.success('Quotas saved');
      await load(true);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async (): Promise<void> => {
    setTesting(true);
    try {
      const result = await adminRequest<{ sent: boolean; error: string | null }>('/api/admin/email/test', { method: 'POST' });
      if (result.sent) toast.success('Test email sent. Check your inbox.');
      else toast.error(`Not sent: ${result.error}`);
      await load(false);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setTesting(false);
    }
  };

  if (error) return <p className="text-sm text-destructive" role="alert">{error}</p>;
  if (!usage || !form) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isOff = usage.missing.length > 0;
  return (
    <div className="space-y-6 max-w-4xl">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-1.5">
            <CardTitle className="text-base flex items-center gap-2">
              <span className={`inline-block w-2 h-2 rounded-full ${isOff ? 'bg-red-500' : 'bg-green-500'}`} />
              {isOff ? 'Email is off' : `Sending from ${usage.from} through Amazon SES (${usage.region})`}
            </CardTitle>
            <CardDescription>
              {isOff
                ? `Nothing is emailed until these are set in the server .env, followed by a restart: ${usage.missing.join(', ')}. Admins still get every link to copy.`
                : 'Invites, forgot-password and admin reset links are emailed while the quotas below allow it.'}
            </CardDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={() => void load(false)} aria-label="Refresh">
            <RefreshCw />
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <UsageBar label="Sent today" used={usage.sent.today} limit={usage.sent.dailyLimit} />
          <UsageBar label="Sent this month" used={usage.sent.thisMonth} limit={usage.sent.monthlyLimit} />
          <UsageBar label="Forgot-password emails today" used={usage.resets.today} limit={usage.resets.dailyLimit} />
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <span className="text-sm">
              Failed today:{' '}
              <span className={`tabular-nums font-medium ${usage.failedToday ? 'text-destructive' : ''}`}>{usage.failedToday}</span>
            </span>
            {!isOff && (
              <Button variant="outline" size="sm" onClick={() => void sendTest()} disabled={testing}>
                {testing ? <Loader2 className="animate-spin" /> : <Send />}
                Send test email to me
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Counts are emails Entrify sent, per UTC day and month.
          </p>
        </CardContent>
      </Card>

      {!isOff && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Amazon SES account</CardTitle>
            <CardDescription>
              Read live from SES. AWS sets these limits; they cover everything this AWS account sends, over a rolling 24
              hours.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {usage.sesAccount ? (
              <SesAccountDetails account={usage.sesAccount} />
            ) : (
              <p className="text-sm text-destructive" role="alert">
                Could not read the SES account: {usage.sesAccountError}. The server&apos;s IAM role needs ses:GetAccount.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <form onSubmit={save}>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quotas</CardTitle>
            <CardDescription>
              Entrify&apos;s own budget, kept below the SES account&apos;s quota above (200 a day while in the
              sandbox). Once a quota is reached nothing more is emailed until the next UTC day or month, and admins copy
              the links instead. 0 means no limit.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              {QUOTA_FIELDS.map(({ key, label }) => (
                <div key={key} className="space-y-2">
                  <Label htmlFor={key}>{label}</Label>
                  <Input
                    id={key}
                    type="number"
                    min={0}
                    step={1}
                    required
                    value={form[key]}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  />
                </div>
              ))}
            </div>
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save quotas'}</Button>
          </CardContent>
        </Card>
      </form>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent failures</CardTitle>
          <CardDescription>The last 20 emails that were not sent: refused by SES, or held back by a quota.</CardDescription>
        </CardHeader>
        <CardContent>
          {usage.recentFailures.length === 0 ? (
            <p className="text-sm text-muted-foreground">No failures.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4">When</th>
                    <th className="pb-2 pr-4">Email</th>
                    <th className="pb-2 pr-4">To</th>
                    <th className="pb-2">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.recentFailures.map((failure) => (
                    <tr key={failure.id} className="border-b align-top">
                      <td className="py-2 pr-4 whitespace-nowrap text-muted-foreground">
                        {new Date(failure.createdAt).toLocaleString()}
                      </td>
                      <td className="py-2 pr-4">{failure.kind}</td>
                      <td className="py-2 pr-4">{failure.recipient}</td>
                      <td className="py-2 text-xs text-muted-foreground break-all">{failure.error}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
