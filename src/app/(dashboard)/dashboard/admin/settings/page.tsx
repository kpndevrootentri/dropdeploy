'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { adminRequest } from '@/components/admin/admin-request';
import { MaintenancePanel } from '@/components/admin/maintenance-panel';

interface Settings {
  defaultProjectQuota: number;
  defaultDomainQuota: number;
  signupOpen: boolean;
  bannerMessage: string | null;
  proxyHitRetentionDays: number;
  publicRegistrationAllowed: boolean;
}

export default function AdminSettingsPage(): React.ReactElement {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Number inputs are edited as text so a half-typed value is not coerced to 0.
  const [form, setForm] = useState({ projectQuota: '', domainQuota: '', retentionDays: '', banner: '', signupOpen: true });

  const apply = (s: Settings): void => {
    setSettings(s);
    setForm({
      projectQuota: String(s.defaultProjectQuota),
      domainQuota: String(s.defaultDomainQuota),
      retentionDays: String(s.proxyHitRetentionDays),
      banner: s.bannerMessage ?? '',
      signupOpen: s.signupOpen,
    });
  };

  useEffect(() => {
    adminRequest<Settings>('/api/admin/settings').then(apply).catch((e: Error) => setError(e.message));
  }, []);

  const save = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!settings) return;
    const edited = {
      defaultProjectQuota: Number(form.projectQuota),
      defaultDomainQuota: Number(form.domainQuota),
      proxyHitRetentionDays: Number(form.retentionDays),
      // The server stores a blank banner as null.
      bannerMessage: form.banner.trim() || null,
      signupOpen: form.signupOpen,
    };
    // Only the fields changed here, so another admin's concurrent change to a different field survives.
    const body = Object.fromEntries(Object.entries(edited).filter(([key, value]) => value !== settings[key as keyof typeof edited]));
    if (Object.keys(body).length === 0) {
      toast.info('No changes to save');
      return;
    }
    setSaving(true);
    try {
      apply(await adminRequest<Settings>('/api/admin/settings', { method: 'PATCH', body }));
      toast.success('Settings saved');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (error) return <p className="text-sm text-destructive" role="alert">{error}</p>;
  if (!settings) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-8">
      <form onSubmit={save} className="space-y-4 max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New accounts</CardTitle>
            <CardDescription>Applied when an account is created, by an admin, by import or by sign-up. Existing users keep their quotas.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="default-project-quota">Default max projects</Label>
              <Input id="default-project-quota" type="number" min={0} max={1000} step={1} required value={form.projectQuota} onChange={(e) => setForm({ ...form, projectQuota: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="default-domain-quota">Default max custom domains</Label>
              <Input id="default-domain-quota" type="number" min={0} max={1000} step={1} required value={form.domainQuota} onChange={(e) => setForm({ ...form, domainQuota: e.target.value })} />
            </div>
            <div className="sm:col-span-2 space-y-1">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={settings.publicRegistrationAllowed && form.signupOpen}
                  disabled={!settings.publicRegistrationAllowed}
                  onChange={(e) => setForm({ ...form, signupOpen: e.target.checked })}
                />
                Allow self sign-up
              </label>
              <p className="text-xs text-muted-foreground">
                {settings.publicRegistrationAllowed
                  ? 'The server allows sign-up (ALLOW_PUBLIC_REGISTRATION). Untick to close it without a redeploy.'
                  : 'Closed by the server: ALLOW_PUBLIC_REGISTRATION is off. Only whoever runs the server can open sign-up, because emails are not verified.'}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Maintenance banner</CardTitle>
            <CardDescription>Shown above the dashboard to every signed-in user. Leave empty to hide it.</CardDescription>
          </CardHeader>
          <CardContent>
            <Label htmlFor="banner-message" className="sr-only">Banner message</Label>
            <Textarea id="banner-message" rows={2} maxLength={500} value={form.banner} onChange={(e) => setForm({ ...form, banner: e.target.value })} placeholder="Deploys are paused 18:00–18:30 UTC for maintenance." />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Traffic data</CardTitle>
            <CardDescription>How long the Maintenance cleanup keeps proxy hits. Minimum 7 days.</CardDescription>
          </CardHeader>
          <CardContent className="max-w-xs space-y-2">
            <Label htmlFor="retention-days">Keep proxy hits for (days)</Label>
            <Input id="retention-days" type="number" min={7} max={3650} step={1} required value={form.retentionDays} onChange={(e) => setForm({ ...form, retentionDays: e.target.value })} />
          </CardContent>
        </Card>

        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</Button>
      </form>
      <MaintenancePanel />
    </div>
  );
}
