'use client';

import { useEffect, useState } from 'react';
import { Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Shown on every dashboard page while an admin views the dashboard as another user. */
export function ImpersonationBanner(): React.ReactElement | null {
  const [email, setEmail] = useState<string | null>(null);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    fetch('/api/auth/session')
      .then((res) => res.json())
      .then((body) => setEmail(body?.data?.impersonating ? body.data.email : null))
      .catch(() => setEmail(null));
  }, []);

  if (!email) return null;

  const exit = async (): Promise<void> => {
    setExiting(true);
    const res = await fetch('/api/auth/impersonation/exit', { method: 'POST' }).catch(() => null);
    // A full load, so nothing from the user's session stays in memory.
    window.location.href = res?.ok ? '/dashboard/admin/users' : '/login';
  };

  return (
    <div
      role="status"
      className="sticky top-0 z-50 flex items-center justify-center gap-3 bg-amber-400 px-4 py-1.5 text-sm font-medium text-amber-950"
    >
      <Eye className="h-4 w-4 shrink-0" aria-hidden />
      <span className="truncate">
        Viewing as <strong>{email}</strong> — read-only
      </span>
      <Button size="sm" variant="outline" className="h-7 border-amber-950/30 bg-transparent" onClick={() => void exit()} disabled={exiting}>
        {exiting ? 'Exiting…' : 'Exit'}
      </Button>
    </div>
  );
}
