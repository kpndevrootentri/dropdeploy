'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';

interface Session {
  userId: string;
  email: string;
  role?: string;
}

export function DashboardNav(): React.ReactElement {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const pathname = usePathname();
  const isAdminRoute = pathname.startsWith('/dashboard/admin');

  useEffect(() => {
    fetch('/api/auth/session')
      .then((res) => res.json())
      .then((data) => {
        if (data?.success && data?.data) {
          setSession(data.data);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleLogout = async (): Promise<void> => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setSession(null);
    window.location.href = '/login';
  };

  if (loading) {
    return <span className="text-sm text-muted-foreground">Loading…</span>;
  }

  if (!session) {
    return (
      <div className="flex items-center gap-2">
        <ThemeToggle variant="ghost" size="icon" />
        <Link href="/login">
          <Button variant="secondary" size="sm">
            Log in
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <ThemeToggle variant="ghost" size="icon" />
      {session.role === 'CONTRIBUTOR' && (
        <Link href={isAdminRoute ? '/dashboard' : '/dashboard/admin'}>
          <Button variant="secondary" size="sm">
            {isAdminRoute ? 'User Mode' : 'Admin Mode'}
          </Button>
        </Link>
      )}
      <span className="text-sm text-muted-foreground">{session.email}</span>
      <Button variant="secondary" size="sm" onClick={handleLogout}>
        Log out
      </Button>
    </div>
  );
}
