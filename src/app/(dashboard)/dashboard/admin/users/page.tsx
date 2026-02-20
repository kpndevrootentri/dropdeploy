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

interface AdminUser {
  id: string;
  email: string;
  role: string;
  createdAt: string;
  _count: { projects: number };
}

export default function AdminUsersPage(): React.ReactElement {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  // Modal state
  const [open, setOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePassword, setInvitePassword] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);

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
    setOpen(true);
  };

  const handleChangeRole = async (userId: string, currentRole: string): Promise<void> => {
    const newRole = currentRole === 'CONTRIBUTOR' ? 'USER' : 'CONTRIBUTOR';
    if (!confirm(`Change role to ${newRole}?`)) return;
    setActing(userId + 'role');
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
    setActing(userId + 'delete');
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
                <th className="pb-2 pr-4">Projects</th>
                <th className="pb-2 pr-4">Created</th>
                <th className="pb-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isActing = acting?.startsWith(u.id);
                return (
                  <tr key={u.id} className="border-b">
                    <td className="py-3 pr-4 font-medium">{u.email}</td>
                    <td className="py-3 pr-4">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                        u.role === 'CONTRIBUTOR'
                          ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
                          : 'bg-muted text-muted-foreground'
                      }`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="py-3 pr-4">{u._count?.projects ?? 0}</td>
                    <td className="py-3 pr-4 text-muted-foreground">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-3">
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={!!isActing}
                          onClick={() => handleChangeRole(u.id, u.role)}
                        >
                          {u.role === 'CONTRIBUTOR' ? 'Demote' : 'Promote'}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={!!isActing}
                          onClick={() => handleDelete(u.id, u.email)}
                        >
                          Delete
                        </Button>
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
              <Input
                id="invite-password"
                type="password"
                value={invitePassword}
                onChange={(e) => setInvitePassword(e.target.value)}
                required
                minLength={8}
                placeholder="Min 8 characters"
                autoComplete="new-password"
              />
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
