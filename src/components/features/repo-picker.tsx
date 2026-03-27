'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, Search, Lock, Globe, RefreshCw, GitBranch, ArrowLeft } from 'lucide-react';

interface RepoItem {
  id: string;
  name: string;
  fullName: string;
  url: string;
  private: boolean;
  defaultBranch: string;
  description: string | null;
  updatedAt: string;
}

export interface RepoPickerProps {
  provider: 'GITHUB' | 'GITLAB';
  onSelect: (repo: RepoItem) => void;
  onBack: () => void;
}

function formatRelative(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export function RepoPicker({ provider, onSelect, onBack }: RepoPickerProps): React.ReactElement {
  const [query, setQuery] = useState('');
  const [repos, setRepos] = useState<RepoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const fetchRepos = useCallback(async (q: string, refresh = false): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ q, page: '1' });
      if (refresh) params.set('refresh', '1');
      const res = await fetch(`/api/git-providers/${provider.toLowerCase()}/repos?${params}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? 'Failed to load repositories');
      } else {
        setRepos(data.data ?? []);
      }
    } catch {
      setError('Something went wrong loading repositories');
    } finally {
      setLoading(false);
    }
  }, [provider]);

  useEffect(() => {
    void fetchRepos('');
    setTimeout(() => searchRef.current?.focus(), 50);
  }, [fetchRepos]);

  const handleQueryChange = (value: string): void => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void fetchRepos(value), 300);
  };

  const label = provider === 'GITHUB' ? 'GitHub' : 'GitLab';

  return (
    <div className="flex flex-col gap-4">
      {/* Back + title */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <span className="text-sm font-semibold">Pick a {label} repository</span>
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-1.5">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <Input
          ref={searchRef}
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder={`Search ${label} repositories…`}
          className="h-7 border-0 bg-transparent px-0 focus-visible:ring-0 focus-visible:ring-offset-0"
        />
        <button
          type="button"
          onClick={() => void fetchRepos(query, true)}
          title="Refresh"
          className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* List */}
      <div className="rounded-lg border overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading repositories…
          </div>
        ) : error ? (
          <div className="px-4 py-8 text-center text-sm text-destructive">{error}</div>
        ) : repos.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            {query ? `No repositories matching "${query}"` : 'No repositories found'}
          </div>
        ) : (
          <ul>
            {repos.map((repo) => (
              <li key={repo.id} className="border-b last:border-0">
                <button
                  type="button"
                  onClick={() => onSelect(repo)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
                >
                  <span className="mt-0.5 shrink-0 text-muted-foreground">
                    {repo.private
                      ? <Lock className="h-3.5 w-3.5" />
                      : <Globe className="h-3.5 w-3.5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium">{repo.fullName}</span>
                      {repo.private && (
                        <Badge variant="outline" className="h-4 shrink-0 px-1.5 text-[10px]">
                          Private
                        </Badge>
                      )}
                    </div>
                    {repo.description && (
                      <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                        {repo.description}
                      </p>
                    )}
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-0.5">
                        <GitBranch className="h-3 w-3" />
                        {repo.defaultBranch}
                      </span>
                      <span>·</span>
                      <span>Updated {formatRelative(repo.updatedAt)}</span>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
