import { Suspense } from 'react';
import Link from 'next/link';
import { connection } from 'next/server';
import { DashboardNav } from '@/components/features/dashboard-nav';
import { ImpersonationBanner } from '@/components/features/impersonation-banner';
import { EntrifyLogo } from '@/components/ui/entrify-logo';
import { platformSettingsService } from '@/services/platform-settings/platform-settings.service';

async function MaintenanceBanner(): Promise<React.ReactElement | null> {
  // Render per request, not at build time, so the banner reflects the database.
  await connection();
  // One primary-key read per full page load (layouts persist across client
  // navigation); a failure only hides the banner, never the dashboard.
  const bannerMessage = await platformSettingsService.get().then((s) => s.bannerMessage, () => null);
  if (!bannerMessage) return null;
  return (
    <div role="status" className="border-b bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100 sm:px-6">
      {bannerMessage}
    </div>
  );
}

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
              <Link href="/dashboard" className="flex hover:opacity-80 transition-opacity">
                <EntrifyLogo className="h-7 w-auto" />
              </Link>
            </h1>
            <DashboardNav />
          </div>
        </header>
      </div>
      {/* Streamed in, so the settings read never holds back the first byte of the page. */}
      <Suspense fallback={null}>
        <MaintenanceBanner />
      </Suspense>
      <main className="p-4 sm:p-6">{children}</main>
    </div>
  );
}
