'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ThemeToggle } from '@/components/theme-toggle';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import {
  LogOut,
  Settings,
  ShieldCheck,
  LayoutDashboard,
  ChevronDown,
  User,
} from 'lucide-react';

interface Session {
  userId: string;
  email: string;
  role?: string;
}

function UserAvatar({ email }: { email: string }): React.ReactElement {
  const initials = email.slice(0, 2).toUpperCase();
  return (
    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground select-none">
      {initials}
    </span>
  );
}

export function DashboardNav(): React.ReactElement {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const pathname = usePathname();
  const router = useRouter();
  const isAdminRoute = pathname.startsWith('/dashboard/admin');
  const isContributor = session?.role === 'CONTRIBUTOR';

  useEffect(() => {
    fetch('/api/auth/session')
      .then((res) => res.json())
      .then((data) => {
        if (data?.success && data?.data) setSession(data.data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleLogout = async (): Promise<void> => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2">
        <div className="h-7 w-7 rounded-full bg-muted animate-pulse" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex items-center gap-2">
        <ThemeToggle variant="ghost" size="icon" />
        <Link href="/login">
          <Button variant="secondary" size="sm">Log in</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <ThemeToggle variant="ghost" size="icon" />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <UserAvatar email={session.email} />
            <span className="hidden sm:block max-w-[160px] truncate text-sm text-muted-foreground">
              {session.email}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-56">
          {/* Identity header */}
          <DropdownMenuLabel className="font-normal">
            <div className="flex items-center gap-2.5">
              <UserAvatar email={session.email} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold leading-tight">{session.email}</p>
                <p className="text-[11px] text-muted-foreground capitalize">
                  {isContributor ? 'Contributor' : 'User'}
                </p>
              </div>
            </div>
          </DropdownMenuLabel>

          <DropdownMenuSeparator />

          {/* Navigation */}
          <DropdownMenuGroup>
            <DropdownMenuItem asChild>
              <Link href="/dashboard" className="cursor-pointer">
                <LayoutDashboard />
                Dashboard
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/settings" className="cursor-pointer">
                <Settings />
                Settings
              </Link>
            </DropdownMenuItem>
          </DropdownMenuGroup>

          {/* Contributor admin toggle */}
          {isContributor && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem asChild>
                  <Link
                    href={isAdminRoute ? '/dashboard' : '/dashboard/admin'}
                    className="cursor-pointer"
                  >
                    <ShieldCheck />
                    {isAdminRoute ? 'Exit Admin Mode' : 'Admin Panel'}
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </>
          )}

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onClick={handleLogout}
            className="cursor-pointer text-destructive focus:text-destructive"
          >
            <LogOut />
            Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
