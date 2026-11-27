import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { showcaseService } from '@/services/showcase/showcase.service';
import { cohortService } from '@/services/cohort';
import { SHOWCASE_TAGS, type ShowcaseTag } from '@/services/showcase/showcase.service';
import { ExploreGrid } from '@/components/features/explore-grid';
import { getSessionFromCookies } from '@/lib/get-session';
import { Search } from 'lucide-react';

const TAG_LABELS: Record<ShowcaseTag, string> = {
  api: 'API',
  dashboard: 'Dashboard',
  bot: 'Bot',
  data: 'Data Tool',
  utility: 'Utility',
  web: 'Web App',
  ml: 'ML / AI',
  cli: 'CLI',
  other: 'Other',
};

interface PageProps {
  searchParams: Promise<{ tag?: string; q?: string; cohortId?: string }>;
}

/** An /explore link that keeps only the filters that are set. */
function exploreHref(params: Record<string, string | undefined>): string {
  const query = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1])).toString();
  return query ? `/explore?${query}` : '/explore';
}

export const revalidate = 60;

export const metadata: Metadata = {
  title: 'Explore projects built on Entrify',
  description:
    'Browse public apps, APIs, dashboards, bots and tools that people have built and deployed on Entrify, and open each one live.',
  alternates: { canonical: '/explore' },
};

export default async function ExplorePage({ searchParams }: PageProps) {
  const { tag, q, cohortId: requestedCohort } = await searchParams;
  const session = await getSessionFromCookies();
  // Batch names are internal: only admins and mentors get the filter (GET /api/showcase checks it the same way).
  const { cohorts, cohortId } = await cohortService.exploreFilter(session?.mustResetPassword ? null : session, requestedCohort);

  const { items: initialItems, total: initialTotal } = await showcaseService.getPublished({
    skip: 0,
    take: 12,
    tag,
    q,
    cohortId,
  });

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-background/80 backdrop-blur-xs sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            Entrify
          </Link>
          <span className="text-sm text-muted-foreground hidden sm:block">Explore</span>
          {session ? (
            <Link href="/dashboard">
              <div className="flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors">
                <div className="h-5 w-5 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-xs shrink-0">
                  {session.email[0].toUpperCase()}
                </div>
                <span className="hidden sm:block max-w-[120px] truncate">{session.email.split('@')[0]}</span>
              </div>
            </Link>
          ) : (
            <Link href="/login">
              <Button variant="outline" size="sm">Sign in</Button>
            </Link>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-12 space-y-10">
        {/* Hero */}
        <div className="space-y-4 text-center">
          <h1 className="text-3xl font-bold tracking-tight">Explore Tools</h1>
          <p className="text-muted-foreground max-w-md mx-auto">
            Discover apps, APIs, and utilities built and deployed by the community.
          </p>
          <div className="pt-1">
            <Link href="/login">
              <Button size="sm">Publish your tool</Button>
            </Link>
          </div>
        </div>

        {/* Search + filters */}
        <div className="space-y-4">
          <form method="GET" className="relative max-w-sm mx-auto">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <input
              name="q"
              defaultValue={q ?? ''}
              placeholder="Search tools…"
              className="w-full rounded-md border bg-background pl-9 pr-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring"
            />
            {cohortId && <input type="hidden" name="cohortId" value={cohortId} />}
          </form>

          {cohorts.length > 0 && (
            <form method="GET" className="flex flex-wrap items-center justify-center gap-2 text-sm">
              {tag && <input type="hidden" name="tag" value={tag} />}
              {q && <input type="hidden" name="q" value={q} />}
              <label htmlFor="explore-batch" className="text-muted-foreground">Batch</label>
              <select
                id="explore-batch"
                name="cohortId"
                defaultValue={cohortId ?? ''}
                className="rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring"
              >
                <option value="">All batches</option>
                {cohorts.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <Button type="submit" variant="outline" size="sm">Filter</Button>
            </form>
          )}

          <div className="flex flex-wrap gap-2 justify-center">
            <Link href={exploreHref({ cohortId })}>
              <Badge variant={!tag ? 'default' : 'outline'} className="cursor-pointer px-3 py-1 text-xs">
                All
              </Badge>
            </Link>
            {SHOWCASE_TAGS.map((t) => (
              <Link key={t} href={exploreHref({ tag: t, q, cohortId })}>
                <Badge
                  variant={tag === t ? 'default' : 'outline'}
                  className="cursor-pointer px-3 py-1 text-xs"
                >
                  {TAG_LABELS[t]}
                </Badge>
              </Link>
            ))}
          </div>
        </div>

        {/* Results count */}
        <p className="text-sm text-muted-foreground text-center">
          {initialTotal === 0
            ? 'No tools found'
            : `${initialTotal} tool${initialTotal !== 1 ? 's' : ''}${tag ? ` in ${TAG_LABELS[tag as ShowcaseTag] ?? tag}` : ''}`}
        </p>

        {/* Grid with infinite scroll */}
        <ExploreGrid
          initialItems={initialItems}
          initialTotal={initialTotal}
          tag={tag}
          q={q}
          cohortId={cohortId}
        />
      </main>
    </div>
  );
}
