import Link from 'next/link';
import type { Metadata } from 'next';
import { Button } from '@/components/ui/button';
import { DocsSidebar } from '@/components/docs/docs-sidebar';
import { getSessionFromCookies } from '@/lib/get-session';

export const metadata: Metadata = {
  title: 'Docs — DropDeploy',
  description: 'Learn how to create, configure, and deploy projects on DropDeploy.',
};

export default async function DocsLayout({ children }: { children: React.ReactNode }): Promise<React.ReactElement> {
  const session = await getSessionFromCookies();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-background/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <Link href="/" className="text-sm font-semibold tracking-tight hover:opacity-80 transition-opacity">
              DropDeploy
            </Link>
            <span className="text-sm text-muted-foreground hidden sm:block">Documentation</span>
          </div>
          {session ? (
            <Link href="/dashboard">
              <Button size="sm" variant="outline">Dashboard</Button>
            </Link>
          ) : (
            <Link href="/login">
              <Button size="sm">Get Started</Button>
            </Link>
          )}
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-10 flex gap-12">
        <aside className="w-52 shrink-0 hidden lg:block">
          <div className="sticky top-20">
            <DocsSidebar />
          </div>
        </aside>
        <main className="flex-1 min-w-0 max-w-3xl">
          {children}
        </main>
      </div>
    </div>
  );
}
