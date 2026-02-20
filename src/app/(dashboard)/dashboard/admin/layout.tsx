import Link from 'next/link';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="space-y-6">
      <nav className="flex gap-4 border-b pb-3">
        <Link
          href="/dashboard/admin"
          className="text-sm font-medium hover:text-foreground text-muted-foreground"
        >
          Overview
        </Link>
        <Link
          href="/dashboard/admin/projects"
          className="text-sm font-medium hover:text-foreground text-muted-foreground"
        >
          Projects
        </Link>
        <Link
          href="/dashboard/admin/users"
          className="text-sm font-medium hover:text-foreground text-muted-foreground"
        >
          Users
        </Link>
      </nav>
      {children}
    </div>
  );
}
