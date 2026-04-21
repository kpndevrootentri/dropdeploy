'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FRAMEWORK_CONFIG } from '@/components/ui/framework-logo';
import { Globe, Loader2 } from 'lucide-react';
import type { ShowcaseWithProject } from '@/repositories/showcase.repository';
import type { ShowcaseTag } from '@/services/showcase/showcase.service';

const PAGE_SIZE = 12;

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

interface ExploreGridProps {
  initialItems: ShowcaseWithProject[];
  initialTotal: number;
  tag?: string;
  q?: string;
}

export function ExploreGrid({ initialItems, initialTotal, tag, q }: ExploreGridProps) {
  const [items, setItems] = useState(initialItems);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const skipRef = useRef(initialItems.length);

  // Reset when filters change (tag/q cause server re-render with new initialItems)
  useEffect(() => {
    setItems(initialItems);
    setTotal(initialTotal);
    skipRef.current = initialItems.length;
    setError(null);
  }, [initialItems, initialTotal, tag, q]);

  const hasMore = items.length < total;

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        skip: String(skipRef.current),
        take: String(PAGE_SIZE),
        ...(tag ? { tag } : {}),
        ...(q ? { q } : {}),
      });
      const res = await fetch(`/api/showcase?${params.toString()}`);
      const data = await res.json() as {
        success: boolean;
        data?: { items: ShowcaseWithProject[]; total: number; hasMore: boolean };
        error?: { message: string };
      };
      if (!res.ok || !data.success || !data.data) {
        setError(data.error?.message ?? 'Failed to load more');
        return;
      }
      setItems((prev) => [...prev, ...data.data!.items]);
      setTotal(data.data.total);
      skipRef.current += data.data.items.length;
    } catch {
      setError('Failed to load more tools');
    } finally {
      setLoading(false);
    }
  }, [loading, hasMore, tag, q]);

  // IntersectionObserver watches the sentinel div
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void loadMore();
        }
      },
      { rootMargin: '200px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  if (items.length === 0) {
    return (
      <div className="text-center py-20 text-muted-foreground space-y-2">
        <p className="text-4xl">🔍</p>
        <p className="text-sm">No tools match your search.</p>
        <Link href="/explore">
          <Button variant="ghost" size="sm" className="mt-2">Clear filters</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const fw = item.project.type as keyof typeof FRAMEWORK_CONFIG;
          const config = FRAMEWORK_CONFIG[fw] ?? FRAMEWORK_CONFIG.STATIC;
          const { Logo } = config;
          const ownerHandle = item.project.user.email.split('@')[0];

          return (
            <Link
              key={item.id}
              href={`/explore/${item.project.slug}`}
              className="group rounded-xl border bg-card p-5 flex flex-col gap-4 hover:shadow-md hover:border-primary/40 transition-all"
            >
              <div className="flex items-start gap-3">
                <div className="shrink-0 mt-0.5">
                  <Logo size={28} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm truncate group-hover:text-primary transition-colors">
                    {item.project.name}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">by {ownerHandle}</p>
                </div>
              </div>

              <p className="text-sm text-muted-foreground line-clamp-2 flex-1">
                {item.shortDescription}
              </p>

              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1">
                  {item.tags.map((t) => (
                    <Badge key={t} variant="secondary" className="text-xs font-normal px-2 py-0">
                      {TAG_LABELS[t as ShowcaseTag] ?? t}
                    </Badge>
                  ))}
                </div>
                {item.liveUrl && (
                  <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                )}
              </div>
            </Link>
          );
        })}
      </div>

      {/* Sentinel + feedback */}
      <div ref={sentinelRef} className="flex justify-center py-4">
        {loading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
        {error && (
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span>{error}</span>
            <Button variant="ghost" size="sm" onClick={() => { void loadMore(); }}>Retry</Button>
          </div>
        )}
        {!loading && !error && !hasMore && items.length > PAGE_SIZE && (
          <p className="text-xs text-muted-foreground">All {total} tools loaded</p>
        )}
      </div>
    </div>
  );
}
