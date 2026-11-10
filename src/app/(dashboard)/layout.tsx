import Link from 'next/link';
import { DashboardNav } from '@/components/features/dashboard-nav';
import { ImpersonationBanner } from '@/components/features/impersonation-banner';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="min-h-screen">
      {/* One sticky block, so the view-as banner stacks above the header instead of covering it. */}
      <div className="sticky top-0 z-40">
        <ImpersonationBanner />
        <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="flex h-14 items-center justify-between px-4 sm:px-6">
            <h1 className="text-base font-semibold tracking-tight">
              <Link href="/dashboard" className="hover:opacity-80 transition-opacity">DropDeploy</Link>
            </h1>
            <DashboardNav />
          </div>
        </header>
      </div>
      <main className="p-4 sm:p-6">{children}</main>
    </div>
  );
}
