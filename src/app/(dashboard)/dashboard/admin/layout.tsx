'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, FolderGit2, Users } from 'lucide-react';

const tabs = [
  { href: '/dashboard/admin',          label: 'Overview', icon: LayoutDashboard, exact: true  },
  { href: '/dashboard/admin/projects', label: 'Projects', icon: FolderGit2,       exact: false },
  { href: '/dashboard/admin/users',    label: 'Users',    icon: Users,            exact: false },
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const pathname = usePathname();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Admin Panel</h1>
        <p className="text-sm text-muted-foreground">Manage users, projects, and system settings.</p>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b">
        {tabs.map(({ href, label, icon: Icon, exact }) => {
          const isActive = exact ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`
                relative inline-flex items-center gap-2 px-3 py-2.5 text-sm font-medium rounded-t-md
                transition-colors select-none
                ${isActive
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}
              `}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-foreground rounded-full" />
              )}
            </Link>
          );
        })}
      </div>

      {/* Page content */}
      {children}
    </div>
  );
}
