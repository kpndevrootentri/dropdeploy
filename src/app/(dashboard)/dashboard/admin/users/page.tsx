'use client';

import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Eye, EyeOff, KeyRound, Gauge, ShieldCheck, ShieldOff, Trash2, Loader2, UserX, UserCheck, LogOut, MailPlus } from 'lucide-react';
import { UserBulkQuotaBar, SelectAllCheckbox, RowCheckbox } from '@/components/admin/bulk-actions';
import { CopyValue } from '@/components/ui/copy-value';

interface BulkResult {
  created: { email: string; invitePath: string }[];
  skipped: string[];
  invalid: string[];
}

/** Invite links are returned as paths; the admin shares the full URL. */
function inviteUrl(path: string): string {
  return `${window.location.origin}${path}`;
}

/** Pulls every email-looking token out of pasted text or a CSV, ignoring headers and names. */
function extractEmails(text: string): string[] {
  return [...new Set((text.match(/[^\s,;"'<>()]+@[^\s,;"'<>()]+/g) ?? []).map((e) => e.toLowerCase()))];
}

interface AdminUser {
  id: string;
  email: string;
  role: string;
  projectQuota: number;
  domainQuota: number;
  suspendedAt: string | null;
  /** True until they accept their invite (or replace a password an admin set). */
  mustResetPassword: boolean;
  createdAt: string;
  _count: { projects: number; customDomains: number };
}

export default function AdminUsersPage(): React.ReactElement {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Create user modal
  const [open, setOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  // Bulk import modal
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<BulkResult | null>(null);

  // Reset password modal
  const [resetOpen, setResetOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(null);

  // Quota modal
  const [quotaOpen, setQuotaOpen] = useState(false);
  const [quotaTarget, setQuotaTarget] = useState<AdminUser | null>(null);
  const [quotaValue, setQuotaValue] = useState('');
  const [domainQuotaValue, setDomainQuotaValue] = useState('');
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const [quotaSaving, setQuotaSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/admin/users')
      .then((r) => r.json())
      .then((res) => {
        if (res.success) { setUsers(res.data ?? []); setError(null); }
        else setError(res.error?.message ?? 'Failed to load users');
      })
      .catch(() => setError('Failed to load users'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const openModal = (): void => {
    setInviteEmail('');
    setInviteError(null);
    setInviteLink(null);
    setOpen(true);
  };

  const openResetModal = (user: AdminUser): void => {
    setResetTarget(user);
    setResetPassword('');
    setResetError(null);
    setShowResetPassword(false);
    setGeneratedPassword(null);
    setResetOpen(true);
  };

  /** Lets the server pick the password, then shows it once so the admin can copy it. */
  const handleGeneratePassword = async (): Promise<void> => {
    if (!resetTarget) return;
    setResetError(null);
    setResetting(true);
    try {
      const res = await fetch(`/api/admin/users/${resetTarget.id}/reset-password`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generate: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResetError(body?.error?.message ?? body?.error ?? 'Failed to reset password');
        return;
      }
      setGeneratedPassword(body.data.generatedPassword);
    } catch {
      setResetError('Network error');
    } finally {
      setResetting(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!resetTarget) return;
    setResetError(null);
    setResetting(true);
    try {
      const res = await fetch(`/api/admin/users/${resetTarget.id}/reset-password`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: resetPassword }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResetError(body?.error?.message ?? body?.error ?? 'Failed to reset password');
        return;
      }
      setResetOpen(false);
    } catch {
      setResetError('Network error');
    } finally {
      setResetting(false);
    }
  };

  const handleChangeRole = async (userId: string, currentRole: string): Promise<void> => {
    const newRole = currentRole === 'CONTRIBUTOR' ? 'USER' : 'CONTRIBUTOR';
    if (!confirm(`Change role to ${newRole}?`)) return;
    setActing(`${userId}:role`);
    try {
      const res = await fetch(`/api/admin/users/${userId}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body?.error?.message ?? body?.error ?? 'Failed to change role');
        return;
      }
      load();
    } catch {
      toast.error('Network error');
    } finally {
      setActing(null);
    }
  };

  const handleDelete = async (userId: string, email: string): Promise<void> => {
    if (!confirm(`Delete user "${email}"? All their projects will also be deleted.`)) return;
    setActing(`${userId}:delete`);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body?.error?.message ?? body?.error ?? 'Failed to delete user');
        return;
      }
      load();
    } catch {
      toast.error('Network error');
    } finally {
      setActing(null);
    }
  };

  /** Runs a one-click user action after confirmation, then reloads the table. */
  const runUserAction = async (
    key: string,
    question: string,
    url: string,
    init: RequestInit,
  ): Promise<void> => {
    if (!confirm(question)) return;
    setActing(key);
    try {
      const res = await fetch(url, init);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body?.error?.message ?? body?.error ?? 'Action failed');
        return;
      }
      load();
    } catch {
      alert('Network error');
    } finally {
      setActing(null);
    }
  };

  /** Replaces the user's invite link and shows the new one once, in the create dialog. */
  const handleNewInviteLink = async (user: AdminUser): Promise<void> => {
    if (!confirm(`Create a new invite link for ${user.email}? Any earlier unused link stops working.`)) return;
    setActing(`${user.id}:invite`);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/invite`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body?.error?.message ?? body?.error ?? 'Failed to create an invite link');
        return;
      }
      setInviteEmail(user.email);
      setInviteError(null);
      setInviteLink(inviteUrl(body.data.invitePath));
      setOpen(true);
    } catch {
      toast.error('Network error');
    } finally {
      setActing(null);
    }
  };

  const handleSuspend = (u: AdminUser): Promise<void> => {
    const suspend = !u.suspendedAt;
    return runUserAction(
      `${u.id}:suspend`,
      suspend
        ? `Suspend "${u.email}"? They are signed out everywhere and cannot sign in. Their sites keep running.`
        : `Reinstate "${u.email}"? They will be able to sign in again.`,
      `/api/admin/users/${u.id}/suspend`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ suspended: suspend }) },
    );
  };

  const handleSignOut = (u: AdminUser): Promise<void> =>
    runUserAction(
      `${u.id}:signout`,
      `Sign "${u.email}" out of every browser and the CLI?`,
      `/api/admin/users/${u.id}/sign-out`,
      { method: 'POST' },
    );

  const handleViewAs = async (user: AdminUser): Promise<void> => {
    if (!confirm(`View the dashboard as ${user.email}? It is read-only, ends after 30 minutes and is recorded.`)) return;
    setActing(`${user.id}:viewas`);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/impersonate`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body?.error?.message ?? body?.error ?? 'Could not view as this user');
        setActing(null);
        return;
      }
      // A full load, so no admin state stays in memory under the user's session.
      window.location.href = '/dashboard';
    } catch {
      toast.error('Network error');
      setActing(null);
    }
  };

  const openQuotaModal = (user: AdminUser): void => {
    setQuotaTarget(user);
    setQuotaValue(String(user.projectQuota));
    setDomainQuotaValue(String(user.domainQuota));
    setQuotaError(null);
    setQuotaOpen(true);
  };

  const handleUpdateQuota = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!quotaTarget) return;
    const parsed = parseInt(quotaValue, 10);
    const parsedDomains = parseInt(domainQuotaValue, 10);
    if (isNaN(parsed) || parsed < 0) {
      setQuotaError('Max projects must be a whole number, 0 or more');
      return;
    }
    if (isNaN(parsedDomains) || parsedDomains < 0) {
      setQuotaError('Max custom domains must be a whole number, 0 or more');
      return;
    }
    setQuotaError(null);
    setQuotaSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${quotaTarget.id}/quota`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectQuota: parsed, domainQuota: parsedDomains }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setQuotaError(body?.error?.message ?? body?.error ?? 'Failed to update quota');
        return;
      }
      setQuotaOpen(false);
      load();
    } catch {
      setQuotaError('Network error');
    } finally {
      setQuotaSaving(false);
    }
  };

  const openImportModal = (): void => {
    setImportText('');
    setImportError(null);
    setImportResult(null);
    setImportOpen(true);
  };

  const importEmails = extractEmails(importText);

  const handleImport = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (importEmails.length === 0) {
      setImportError('No email addresses found');
      return;
    }
    setImportError(null);
    setImporting(true);
    try {
      const res = await fetch('/api/admin/users/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails: importEmails }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setImportError(body?.error?.message ?? body?.error ?? 'Failed to import users');
        return;
      }
      setImportResult(body.data);
      load();
    } catch {
      setImportError('Network error');
    } finally {
      setImporting(false);
    }
  };

  const handleInvite = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setInviteError(null);
    setInviting(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setInviteError(body?.error?.message ?? body?.error ?? 'Failed to create user');
        return;
      }
      setInviteLink(inviteUrl(body.data.invitePath));
      load();
    } catch {
      setInviteError('Network error');
    } finally {
      setInviting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Users</h2>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <a href="/api/admin/users/export" download>Export CSV</a>
          </Button>
          <Button variant="outline" onClick={openImportModal}>Import Users</Button>
          <Button onClick={openModal}>Create User</Button>
        </div>
      </div>

      <UserBulkQuotaBar
        selected={users.filter((u) => selected.has(u.id)).map((u) => u.id)}
        emails={new Map(users.map((u) => [u.id, u.email]))}
        onChange={setSelected}
        onDone={load}
      />

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="overflow-x-auto">
          {error && <p className="mb-4 text-sm text-destructive" role="alert">{error}</p>}
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="pb-2 pr-2 w-6">
                  <SelectAllCheckbox ids={users.map((u) => u.id)} selected={selected} onChange={setSelected} />
                </th>
                <th className="pb-2 pr-4">Email</th>
                <th className="pb-2 pr-4">Role</th>
                <th className="pb-2 pr-4">Projects</th>
                <th className="pb-2 pr-4">Domains</th>
                <th className="pb-2 pr-4">Created</th>
                <th className="pb-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isActing = acting?.startsWith(`${u.id}:`);
                const isChangingRole = acting === `${u.id}:role`;
                const isDeleting = acting === `${u.id}:delete`;
                const isContributor = u.role === 'CONTRIBUTOR';
                return (
                  <tr key={u.id} className="border-b">
                    <td className="py-3 pr-2">
                      <RowCheckbox id={u.id} label={u.email} selected={selected} onChange={setSelected} />
                    </td>
                    <td className="py-3 pr-4 font-medium">{u.email}</td>
                    <td className="py-3 pr-4">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                        isContributor
                          ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
                          : 'bg-muted text-muted-foreground'
                      }`}>
                        {u.role}
                      </span>
                      {u.suspendedAt && (
                        <span
                          className="ml-1.5 inline-block px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                          title={`Suspended ${new Date(u.suspendedAt).toLocaleString()}`}
                        >
                          SUSPENDED
                        </span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      <span className={`tabular-nums ${(u._count?.projects ?? 0) >= u.projectQuota ? 'text-amber-600 dark:text-amber-400 font-semibold' : ''}`}>
                        {u._count?.projects ?? 0} / {u.projectQuota}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      <span className={`tabular-nums ${(u._count?.customDomains ?? 0) >= u.domainQuota ? 'text-amber-600 dark:text-amber-400 font-semibold' : ''}`}>
                        {u._count?.customDomains ?? 0} / {u.domainQuota}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        {/* Promote / Demote */}
                        <button
                          title={isContributor ? 'Demote — Remove contributor privileges' : 'Promote — Grant contributor privileges'}
                          disabled={!!isActing}
                          onClick={() => handleChangeRole(u.id, u.role)}
                          className="inline-flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md border border-transparent text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          {isChangingRole
                            ? <Loader2 className="w-4 h-4 animate-spin" />
                            : isContributor
                              ? <ShieldOff className="w-4 h-4" />
                              : <ShieldCheck className="w-4 h-4" />
                          }
                          <span className="text-[10px] leading-none font-medium">
                            {isContributor ? 'Demote' : 'Promote'}
                          </span>
                        </button>

                        {/* Reset Password */}
                        <button
                          title="Reset Password — Set a new password for this user"
                          disabled={!!isActing}
                          onClick={() => openResetModal(u)}
                          className="inline-flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md border border-transparent text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          <KeyRound className="w-4 h-4" />
                          <span className="text-[10px] leading-none font-medium">Reset PW</span>
                        </button>

                        {/* New invite link: only while they have not chosen their own password */}
                        {u.mustResetPassword && (
                          <button
                            title="New invite link — replaces any earlier unused link"
                            disabled={!!isActing}
                            onClick={() => void handleNewInviteLink(u)}
                            className="inline-flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md border border-transparent text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          >
                            {acting === `${u.id}:invite` ? <Loader2 className="w-4 h-4 animate-spin" /> : <MailPlus className="w-4 h-4" />}
                            <span className="text-[10px] leading-none font-medium">Invite link</span>
                          </button>
                        )}

                        {/* View as user */}
                        <button
                          title={isContributor ? 'Admins cannot be viewed as' : 'View as — see the dashboard as this user, read-only, for 30 minutes'}
                          disabled={!!isActing || isContributor}
                          onClick={() => void handleViewAs(u)}
                          className="inline-flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md border border-transparent text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          {acting === `${u.id}:viewas` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                          <span className="text-[10px] leading-none font-medium">View as</span>
                        </button>

                        {/* Set Quota */}
                        <button
                          title="Set quotas — how many projects and custom domains this user can have"
                          disabled={!!isActing}
                          onClick={() => openQuotaModal(u)}
                          className="inline-flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md border border-transparent text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          <Gauge className="w-4 h-4" />
                          <span className="text-[10px] leading-none font-medium">Quota</span>
                        </button>

                        {/* Sign out everywhere */}
                        <button
                          title="Sign out — Revoke every browser session and CLI token"
                          disabled={!!isActing}
                          onClick={() => void handleSignOut(u)}
                          className="inline-flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md border border-transparent text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          {acting === `${u.id}:signout` ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
                          <span className="text-[10px] leading-none font-medium">Sign out</span>
                        </button>

                        {/* Suspend / Unsuspend */}
                        <button
                          title={u.suspendedAt ? 'Unsuspend — Let this user sign in again' : 'Suspend — Block sign-in and sign out everywhere; sites keep running'}
                          disabled={!!isActing}
                          onClick={() => void handleSuspend(u)}
                          className="inline-flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md border border-transparent text-muted-foreground hover:bg-red-50 hover:text-red-600 hover:border-red-200 dark:hover:bg-red-950 dark:hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          {acting === `${u.id}:suspend`
                            ? <Loader2 className="w-4 h-4 animate-spin" />
                            : u.suspendedAt ? <UserCheck className="w-4 h-4" /> : <UserX className="w-4 h-4" />}
                          <span className="text-[10px] leading-none font-medium">{u.suspendedAt ? 'Unsuspend' : 'Suspend'}</span>
                        </button>

                        <div className="w-px h-8 bg-border" />

                        {/* Delete */}
                        <button
                          title="Delete — Permanently removes the user and all their projects"
                          disabled={!!isActing}
                          onClick={() => handleDelete(u.id, u.email)}
                          className="inline-flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md border border-transparent text-muted-foreground hover:bg-red-50 hover:text-red-600 hover:border-red-200 dark:hover:bg-red-950 dark:hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                          <span className="text-[10px] leading-none font-medium">Delete</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {users.length === 0 && !error && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted-foreground">
                    No users found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Reset Password Dialog */}
      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
          </DialogHeader>
          <div className="px-1 py-2 space-y-5">
            <p className="text-sm text-muted-foreground border-b border-border pb-4">
              Setting a new password for{' '}
              <span className="font-semibold text-foreground">{resetTarget?.email}</span>
            </p>
            {generatedPassword ? (
              <div className="space-y-2">
                <CopyValue label="New password" value={generatedPassword} emphasis />
                <p className="text-xs text-muted-foreground">
                  Shown once — copy it now. They must choose their own password when they next sign in, and every
                  session they had is signed out.
                </p>
              </div>
            ) : (
            <form id="reset-password-form" onSubmit={handleResetPassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="reset-password">New password</Label>
                <div className="relative">
                  <Input
                    id="reset-password"
                    type={showResetPassword ? 'text' : 'password'}
                    value={resetPassword}
                    onChange={(e) => setResetPassword(e.target.value)}
                    required
                    minLength={8}
                    placeholder="Min 8 characters"
                    autoComplete="new-password"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowResetPassword((v) => !v)}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                    aria-label={showResetPassword ? 'Hide password' : 'Show password'}
                  >
                    {showResetPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              {resetError && (
                <p className="text-sm text-destructive" role="alert">
                  {resetError}
                </p>
              )}
            </form>
            )}
          </div>
          <DialogFooter className="pt-2 border-t border-border">
            {generatedPassword ? (
              <Button onClick={() => setResetOpen(false)}>Done</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setResetOpen(false)} disabled={resetting}>
                  Cancel
                </Button>
                <Button variant="outline" onClick={() => void handleGeneratePassword()} disabled={resetting}>
                  Generate password
                </Button>
                <Button type="submit" form="reset-password-form" disabled={resetting}>
                  {resetting ? 'Saving…' : 'Reset Password'}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quota Dialog */}
      <Dialog open={quotaOpen} onOpenChange={setQuotaOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Set quotas</DialogTitle>
          </DialogHeader>
          <div className="px-1 py-2 space-y-5">
            <p className="text-sm text-muted-foreground border-b border-border pb-4">
              Updating quotas for{' '}
              <span className="font-semibold text-foreground">{quotaTarget?.email}</span>
            </p>
            <form id="quota-form" onSubmit={handleUpdateQuota} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="quota-value">Max projects</Label>
                <Input
                  id="quota-value"
                  type="number"
                  min={0}
                  step={1}
                  value={quotaValue}
                  onChange={(e) => setQuotaValue(e.target.value)}
                  required
                  placeholder="5"
                />
                <p className="text-xs text-muted-foreground">
                  Default is 5. Set to 0 to block project creation.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="domain-quota-value">Max custom domains</Label>
                <Input
                  id="domain-quota-value"
                  type="number"
                  min={0}
                  step={1}
                  value={domainQuotaValue}
                  onChange={(e) => setDomainQuotaValue(e.target.value)}
                  required
                  placeholder="2"
                />
                <p className="text-xs text-muted-foreground">
                  Counts across all of this user&apos;s projects. Serving a site at both
                  <code className="mx-1 font-mono">example.com</code> and
                  <code className="mx-1 font-mono">www.example.com</code> uses two, so 1 blocks the
                  commonest setup. Set to 0 to disable custom domains for this user.
                </p>
              </div>
              {quotaError && (
                <p className="text-sm text-destructive" role="alert">
                  {quotaError}
                </p>
              )}
            </form>
          </div>
          <DialogFooter className="pt-2 border-t border-border">
            <Button variant="outline" onClick={() => setQuotaOpen(false)} disabled={quotaSaving}>
              Cancel
            </Button>
            <Button type="submit" form="quota-form" disabled={quotaSaving}>
              {quotaSaving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Import Dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Import Users</DialogTitle>
          </DialogHeader>
          {importResult ? (
            <div className="space-y-3 text-sm">
              <p>
                <span className="font-semibold">{importResult.created.length}</span> created ·{' '}
                <span className="font-semibold">{importResult.skipped.length}</span> already existed ·{' '}
                <span className="font-semibold">{importResult.invalid.length}</span> invalid
              </p>
              {importResult.created.length > 0 && (
                <div className="space-y-1">
                  <p className="text-muted-foreground">
                    Invite links — shown once, valid for 7 days. Send each person their own link.
                  </p>
                  <CopyValue
                    label="All links (email, link per line)"
                    value={importResult.created.map((c) => `${c.email},${inviteUrl(c.invitePath)}`).join('\n')}
                  />
                  <ul className="max-h-48 overflow-y-auto space-y-2 pt-1">
                    {importResult.created.map((c) => (
                      <li key={c.email}>
                        <CopyValue label={c.email} value={inviteUrl(c.invitePath)} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {([['Already existed, not changed', importResult.skipped], ['Invalid', importResult.invalid]] as const).map(
                ([label, list]) =>
                  list.length > 0 && (
                    <div key={label} className="space-y-1">
                      <p className="text-muted-foreground">{label}</p>
                      <p className="max-h-32 overflow-y-auto rounded-md bg-muted p-2 font-mono text-xs break-all">
                        {list.join(', ')}
                      </p>
                    </div>
                  ),
              )}
            </div>
          ) : (
            <form id="import-form" onSubmit={handleImport} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="import-emails">Emails</Label>
                <Textarea
                  id="import-emails"
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  rows={8}
                  placeholder={'one@entri.me\ntwo@entri.me'}
                  className="font-mono text-xs"
                />
                <div className="flex items-center justify-between gap-2">
                  <Input
                    type="file"
                    accept=".csv,.txt,text/csv,text/plain"
                    aria-label="Load emails from a CSV or text file"
                    className="max-w-[60%] text-xs"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (file) setImportText(await file.text());
                    }}
                  />
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {importEmails.length} email{importEmails.length === 1 ? '' : 's'} found
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">
                  Paste emails or load a CSV. Any email address in the text is picked up; headers and names are ignored. Up to 500 at a time.
                  Each new user gets their own one-time invite link to choose a password. Existing accounts are skipped, never changed.
                </p>
              </div>
              {importError && (
                <p className="text-sm text-destructive" role="alert">
                  {importError}
                </p>
              )}
            </form>
          )}
          <DialogFooter>
            {importResult ? (
              <Button onClick={() => setImportOpen(false)}>Done</Button>
            ) : (
              <>
                <Button variant="secondary" onClick={() => setImportOpen(false)} disabled={importing}>
                  Cancel
                </Button>
                <Button type="submit" form="import-form" disabled={importing || importEmails.length === 0}>
                  {importing ? 'Importing…' : `Import ${importEmails.length || ''} Users`}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{inviteLink ? 'Invite link' : 'Create User'}</DialogTitle>
          </DialogHeader>
          {inviteLink ? (
            <div className="space-y-2">
              <CopyValue label={`Invite link for ${inviteEmail}`} value={inviteLink} emphasis />
              <p className="text-xs text-muted-foreground">
                Shown once, valid for 7 days, works once, and replaces any earlier link. Send it to them; they choose their own password.
              </p>
            </div>
          ) : (
            <form id="invite-form" onSubmit={handleInvite} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="invite-email">Email</Label>
                <Input
                  id="invite-email"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  required
                  placeholder="user@example.com"
                  autoComplete="off"
                />
                <p className="text-xs text-muted-foreground">
                  You get a one-time invite link to send them. They can&apos;t sign in until they open it and choose a password.
                </p>
              </div>
              {inviteError && (
                <p className="text-sm text-destructive" role="alert">
                  {inviteError}
                </p>
              )}
            </form>
          )}
          <DialogFooter>
            {inviteLink ? (
              <Button onClick={() => setOpen(false)}>Done</Button>
            ) : (
              <>
                <Button variant="secondary" onClick={() => setOpen(false)} disabled={inviting}>
                  Cancel
                </Button>
                <Button type="submit" form="invite-form" disabled={inviting}>
                  {inviting ? 'Creating…' : 'Create User'}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
