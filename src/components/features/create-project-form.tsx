'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FRAMEWORK_CONFIG } from '@/components/ui/framework-logo';
import { RepoPicker } from '@/components/features/repo-picker';
import { cn } from '@/lib/utils';
import { Github, Loader2, CheckCircle2, ChevronDown, AlertCircle, Plus } from 'lucide-react';

type FrameworkType = 'STATIC' | 'NODEJS' | 'NEXTJS' | 'DJANGO' | 'REACT' | 'FASTAPI' | 'FLASK' | 'VUE' | 'SVELTE';
type SourceType = 'GITHUB' | 'GITLAB';

const FRAMEWORK_KEYS: FrameworkType[] = ['STATIC', 'NODEJS', 'NEXTJS', 'DJANGO', 'REACT', 'FASTAPI', 'FLASK', 'VUE', 'SVELTE'];

interface ProviderInfo {
  provider: SourceType;
  username: string;
  avatarUrl: string | null;
}

function detectSource(url: string): SourceType {
  if (url.includes('gitlab.com')) return 'GITLAB';
  return 'GITHUB';
}

function GitLabIcon({ size = 16 }: { size?: number }): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0 1 18.6 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51L23 13.45a.84.84 0 0 1-.35.94z" />
    </svg>
  );
}

const POPUP_WIDTH = 600;
const POPUP_HEIGHT = 700;

export interface CreateProjectFormProps {
  onSuccess?: () => void;
  className?: string;
  embedded?: boolean;
}

export function CreateProjectForm({ onSuccess, className, embedded = false }: CreateProjectFormProps): React.ReactElement {
  const [view, setView] = useState<'form' | 'picker'>('form');
  const [pickerProvider, setPickerProvider] = useState<SourceType | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [showDescription, setShowDescription] = useState(false);
  const [type, setType] = useState<FrameworkType>('STATIC');
  const [repoUrl, setRepoUrl] = useState('');
  const [selectedRepoName, setSelectedRepoName] = useState('');
  const [branch, setBranch] = useState('main');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [connectingProvider, setConnectingProvider] = useState<SourceType | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);

  const popupRef = useRef<Window | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchProviders = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/git-providers');
      const data = await res.json();
      if (res.ok) setProviders(data.data ?? []);
    } catch { /* non-fatal */ }
    finally { setProvidersLoading(false); }
  }, []);

  useEffect(() => {
    void fetchProviders();
  }, [fetchProviders]);

  useEffect(() => {
    const handler = (event: MessageEvent): void => {
      const msg = event.data as { type?: string; provider?: string; error?: string };
      if (msg.type !== 'oauth_success' && msg.type !== 'oauth_error') return;
      if (msg.type === 'oauth_success' && msg.provider) {
        setConnectingProvider(null);
        setConnectError(null);
        if (pollRef.current) clearInterval(pollRef.current);
        void fetchProviders().then(() => {
          setPickerProvider(msg.provider as SourceType);
          setView('picker');
        });
      } else if (msg.type === 'oauth_error') {
        setConnectingProvider(null);
        setConnectError(msg.error ?? 'Failed to connect account');
        if (pollRef.current) clearInterval(pollRef.current);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [fetchProviders]);

  const openConnectPopup = (provider: SourceType): void => {
    setConnectError(null);
    setConnectingProvider(provider);
    const left = window.screenX + (window.outerWidth - POPUP_WIDTH) / 2;
    const top = window.screenY + (window.outerHeight - POPUP_HEIGHT) / 2;
    const url = `/api/auth/${provider.toLowerCase()}/connect?popup=1`;
    const popup = window.open(url, `connect_${provider}`, `width=${POPUP_WIDTH},height=${POPUP_HEIGHT},left=${left},top=${top}`);
    popupRef.current = popup;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      if (popup?.closed) {
        clearInterval(pollRef.current!);
        setConnectingProvider(null);
        void fetchProviders();
      }
    }, 500);
  };

  const openPicker = (provider: SourceType): void => {
    setPickerProvider(provider);
    setView('picker');
  };

  const handleRepoSelect = useCallback((repo: { name: string; url: string; defaultBranch: string }): void => {
    setRepoUrl(repo.url.endsWith('.git') ? repo.url : `${repo.url}.git`);
    setSelectedRepoName(repo.name);
    setBranch(repo.defaultBranch);
    if (!name) setName(repo.name);
    setView('form');
    setPickerProvider(null);
  }, [name]);

  const clearSelectedRepo = (): void => {
    setRepoUrl('');
    setSelectedRepoName('');
  };

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    if (name.trim().length < 3) { setError('Project name must be at least 3 characters'); return; }
    if (!repoUrl.trim()) { setError('Repository URL is required'); return; }
    setLoading(true);
    try {
      const source = detectSource(repoUrl.trim());
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          source,
          type,
          githubUrl: repoUrl.trim(),
          branch: branch.trim() || 'main',
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data?.error?.message ?? 'Failed to create project'); setLoading(false); return; }
      setName(''); setDescription(''); setRepoUrl(''); setSelectedRepoName(''); setBranch('main');
      onSuccess?.();
      setLoading(false);
    } catch {
      setError('Something went wrong');
      setLoading(false);
    }
  };

  const connectedMap = Object.fromEntries(providers.map((p) => [p.provider, p])) as Record<SourceType, ProviderInfo | undefined>;

  // ── Picker view — renders inline inside the same dialog, no nested modal ──
  if (view === 'picker' && pickerProvider) {
    return (
      <RepoPicker
        provider={pickerProvider}
        onSelect={handleRepoSelect}
        onBack={() => setView('form')}
      />
    );
  }

  // ── Form view ──
  const formContent = (
    <form onSubmit={handleSubmit} className="flex flex-col gap-7">

      {/* ── Step 1: Repository ── */}
      <section className="space-y-3">
        <StepHeading n={1} label="Repository" />

        {connectError && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            {connectError}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <ProviderButton
            label="GitHub"
            icon={<Github className="h-4 w-4" />}
            info={connectedMap['GITHUB'] ?? null}
            loading={providersLoading}
            connecting={connectingProvider === 'GITHUB'}
            onConnect={() => openConnectPopup('GITHUB')}
            onPick={() => openPicker('GITHUB')}
          />
          <ProviderButton
            label="GitLab"
            icon={<GitLabIcon size={16} />}
            info={connectedMap['GITLAB'] ?? null}
            loading={providersLoading}
            connecting={connectingProvider === 'GITLAB'}
            onConnect={() => openConnectPopup('GITLAB')}
            onPick={() => openPicker('GITLAB')}
          />
        </div>

        {selectedRepoName ? (
          <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
              <span className="truncate text-sm font-medium">{selectedRepoName}</span>
            </div>
            <button
              type="button"
              onClick={clearSelectedRepo}
              className="ml-3 shrink-0 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Change
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">or paste URL</span>
              <div className="h-px flex-1 bg-border" />
            </div>
            <Input
              type="url"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="https://github.com/username/repo"
              className="font-mono text-sm"
            />
          </>
        )}
      </section>

      {/* ── Step 2: Details ── */}
      <section className="space-y-3">
        <StepHeading n={2} label="Details" />

        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="project-name" className="text-xs text-muted-foreground">Name</Label>
            <Input
              id="project-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-awesome-app"
              minLength={3}
              maxLength={50}
              required
            />
            <p className="text-[11px] text-muted-foreground">3–50 chars · becomes the URL slug</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="branch" className="text-xs text-muted-foreground">Branch</Label>
            <Input
              id="branch"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="main"
              maxLength={100}
            />
          </div>
        </div>

        {showDescription ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="project-description" className="text-xs text-muted-foreground">Description</Label>
              <span className="text-[11px] text-muted-foreground">{description.length}/500</span>
            </div>
            <Textarea
              id="project-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of the project…"
              maxLength={500}
              rows={2}
              className="resize-none text-sm"
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowDescription(true)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <Plus className="h-3 w-3" />
            Add description
          </button>
        )}
      </section>

      {/* ── Step 3: Framework ── */}
      <section className="space-y-3">
        <StepHeading n={3} label="Framework" />

        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {FRAMEWORK_KEYS.map((key) => {
            const { Logo, label } = FRAMEWORK_CONFIG[key];
            const isSelected = type === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setType(key)}
                className={cn(
                  'flex shrink-0 flex-col items-center gap-2 rounded-xl border-2 px-3.5 py-3 transition-all',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  isSelected
                    ? 'border-primary bg-primary/10'
                    : 'border-transparent bg-muted/50 hover:border-border hover:bg-muted'
                )}
                aria-pressed={isSelected}
              >
                <Logo size={28} />
                <span className={cn(
                  'whitespace-nowrap text-[11px] font-semibold',
                  isSelected ? 'text-primary' : 'text-foreground',
                )}>
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <Button type="submit" disabled={loading} className="w-full" size="lg">
        {loading ? (
          <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating…</>
        ) : (
          'Create project'
        )}
      </Button>
    </form>
  );

  if (embedded) return <div className={cn(className)}>{formContent}</div>;

  return (
    <Card className={cn(className)}>
      <CardHeader className="pb-4">
        <CardTitle>Create project</CardTitle>
        <CardDescription>Connect a repository and deploy in seconds.</CardDescription>
      </CardHeader>
      <CardContent>{formContent}</CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// StepHeading
// ---------------------------------------------------------------------------

function StepHeading({ n, label }: { n: number; label: string }): React.ReactElement {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
        {n}
      </span>
      <span className="text-sm font-semibold">{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProviderButton
// ---------------------------------------------------------------------------

function ProviderButton({
  label,
  icon,
  info,
  loading,
  connecting,
  onConnect,
  onPick,
}: {
  label: string;
  icon: React.ReactElement;
  info: ProviderInfo | null;
  loading: boolean;
  connecting: boolean;
  onConnect: () => void;
  onPick: () => void;
}): React.ReactElement {
  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Checking…
      </div>
    );
  }

  if (info) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-green-500/25 bg-green-500/5 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-green-600 dark:text-green-400">{icon}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              <span className="text-xs font-semibold">{label}</span>
              <CheckCircle2 className="h-3 w-3 shrink-0 text-green-500" />
            </div>
            <p className="truncate text-[11px] text-muted-foreground">@{info.username}</p>
          </div>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={onPick} className="h-7 shrink-0 px-2.5 text-xs">
          Browse
          <ChevronDown className="ml-1 h-3 w-3" />
        </Button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onConnect}
      disabled={connecting}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg border-2 border-dashed px-3 py-2.5 text-left transition-colors',
        'hover:border-primary/40 hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      )}
    >
      {connecting ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
      ) : (
        <span className="shrink-0 text-muted-foreground">{icon}</span>
      )}
      <div>
        <p className="text-xs font-semibold">{connecting ? 'Connecting…' : label}</p>
        <p className="text-[11px] text-muted-foreground">
          {connecting ? 'Complete in popup' : 'Connect account'}
        </p>
      </div>
    </button>
  );
}
