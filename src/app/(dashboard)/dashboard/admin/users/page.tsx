'use client';

import { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Eye, EyeOff, KeyRound, Gauge, ShieldCheck, ShieldOff, Trash2, Loader2 } from 'lucide-react';

interface AdminUser {
  id: string;
  email: string;
  role: string;
  projectQuota: number;
  createdAt: string;
  _count: { projects: number };
}

export default function AdminUsersPage(): React.ReactElement {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  // Create user modal
  const [open, setOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePassword, setInvitePassword] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);

  // Reset password modal
  const [resetOpen, setResetOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);

  // Show/hide for create user password
  const [showInvitePassword, setShowInvitePassword] = useState(false);

  // Quota modal
  const [quotaOpen, setQuotaOpen] = useState(false);
  const [quotaTarget, setQuotaTarget] = useState<AdminUser | null>(null);
  const [quotaValue, setQuotaValue] = useState('');
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const [quotaSaving, setQuotaSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/admin/users')
      .then((r) => r.json())
      .then((res) => setUsers(res.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const openModal = (): void => {
    setInviteEmail('');
    setInvitePassword('');
    setInviteError(null);
    setShowInvitePassword(false);
    setOpen(true);
  };

  const openResetModal = (user: AdminUser): void => {
    setResetTarget(user);
    setResetPassword('');
    setResetError(null);
    setShowResetPassword(false);
    setResetOpen(true);
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
        alert(body?.error ?? 'Failed to change role');
        return;
      }
      load();
    } catch {
      alert('Network error');
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
        alert(body?.error ?? 'Failed to delete user');
        return;
      }
      load();
    } catch {
      alert('Network error');
    } finally {
      setActing(null);
    }
  };

  const openQuotaModal = (user: AdminUser): void => {
    setQuotaTarget(user);
    setQuotaValue(String(user.projectQuota));
    setQuotaError(null);
    setQuotaOpen(true);
  };

  const handleUpdateQuota = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!quotaTarget) return;
    const parsed = parseInt(quotaValue, 10);
    if (isNaN(parsed) || parsed < 0) {
      setQuotaError('Quota must be a non-negative integer');
      return;
    }
    setQuotaError(null);
    setQuotaSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${quotaTarget.id}/quota`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectQuota: parsed }),
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

  const handleInvite = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setInviteError(null);
    setInviting(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, password: invitePassword }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setInviteError(body?.error?.message ?? body?.error ?? 'Failed to create user');
        return;
      }
      setOpen(false);
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
        <Button onClick={openModal}>Create User</Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="pb-2 pr-4">Email</th>
                <th className="pb-2 pr-4">Role</th>
                <th className="pb-2 pr-4">Projects / Quota</th>
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
                    <td className="py-3 pr-4 font-medium">{u.email}</td>
                    <td className="py-3 pr-4">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                        isContributor
                          ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
                          : 'bg-muted text-muted-foreground'
                      }`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      <span className={`tabular-nums ${(u._count?.projects ?? 0) >= u.projectQuota ? 'text-amber-600 dark:text-amber-400 font-semibold' : ''}`}>
                        {u._count?.projects ?? 0} / {u.projectQuota}
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

                        {/* Set Quota */}
                        <button
                          title="Set Quota — Change how many projects this user can create"
                          disabled={!!isActing}
                          onClick={() => openQuotaModal(u)}
                          className="inline-flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md border border-transparent text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          <Gauge className="w-4 h-4" />
                          <span className="text-[10px] leading-none font-medium">Quota</span>
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
              {users.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-muted-foreground">
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
          </div>
          <DialogFooter className="pt-2 border-t border-border">
            <Button variant="outline" onClick={() => setResetOpen(false)} disabled={resetting}>
              Cancel
            </Button>
            <Button type="submit" form="reset-password-form" disabled={resetting}>
              {resetting ? 'Saving…' : 'Reset Password'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quota Dialog */}
      <Dialog open={quotaOpen} onOpenChange={setQuotaOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Set Project Quota</DialogTitle>
          </DialogHeader>
          <div className="px-1 py-2 space-y-5">
            <p className="text-sm text-muted-foreground border-b border-border pb-4">
              Updating quota for{' '}
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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create User</DialogTitle>
          </DialogHeader>
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
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-password">Temporary password</Label>
              <div className="relative">
                <Input
                  id="invite-password"
                  type={showInvitePassword ? 'text' : 'password'}
                  value={invitePassword}
                  onChange={(e) => setInvitePassword(e.target.value)}
                  required
                  minLength={8}
                  placeholder="Min 8 characters"
                  autoComplete="new-password"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowInvitePassword((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                  aria-label={showInvitePassword ? 'Hide password' : 'Show password'}
                >
                  {showInvitePassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                The user will be prompted to set their own password on first login.
              </p>
            </div>
            {inviteError && (
              <p className="text-sm text-destructive" role="alert">
                {inviteError}
              </p>
            )}
          </form>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={inviting}>
              Cancel
            </Button>
            <Button type="submit" form="invite-form" disabled={inviting}>
              {inviting ? 'Creating…' : 'Create User'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
