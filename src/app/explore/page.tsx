import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { showcaseService } from '@/services/showcase/showcase.service';
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
  searchParams: Promise<{ tag?: string; q?: string }>;
}

export const revalidate = 60;

export default async function ExplorePage({ searchParams }: PageProps) {
  const { tag, q } = await searchParams;
  const session = await getSessionFromCookies();

  const { items: initialItems, total: initialTotal } = await showcaseService.getPublished({
    skip: 0,
    take: 12,
    tag,
    q,
  });

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-background/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            DropDeploy
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
              className="w-full rounded-md border bg-background pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </form>

          <div className="flex flex-wrap gap-2 justify-center">
            <Link href="/explore">
              <Badge variant={!tag ? 'default' : 'outline'} className="cursor-pointer px-3 py-1 text-xs">
                All
              </Badge>
            </Link>
            {SHOWCASE_TAGS.map((t) => (
              <Link key={t} href={`/explore?tag=${t}${q ? `&q=${q}` : ''}`}>
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
        />
      </main>
    </div>
  );
}
