import Link from 'next/link';
import { connection } from 'next/server';
import { DashboardNav } from '@/components/features/dashboard-nav';
import { platformSettingsService } from '@/services/platform-settings/platform-settings.service';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  // Render per request, not at build time, so the banner reflects the database.
  await connection();
  // One primary-key read per full page load (layouts persist across client
  // navigation); a failure only hides the banner, never the dashboard.
  const bannerMessage = await platformSettingsService.get().then((s) => s.bannerMessage, () => null);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex h-14 items-center justify-between px-4 sm:px-6">
          <h1 className="text-base font-semibold tracking-tight">
            <Link href="/dashboard" className="hover:opacity-80 transition-opacity">DropDeploy</Link>
          </h1>
          <DashboardNav />
        </div>
      </header>
      {bannerMessage && (
        <div role="status" className="border-b bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100 sm:px-6">
          {bannerMessage}
        </div>
      )}
      <main className="p-4 sm:p-6">{children}</main>
    </div>
  );
}
