'use client';

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Link2, Link2Off, Github, AlertCircle } from 'lucide-react';

interface ProviderInfo {
  id: string;
  provider: 'GITHUB' | 'GITLAB';
  username: string;
  avatarUrl: string | null;
  createdAt: string;
}

function GitLabIcon({ size = 16 }: { size?: number }): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0 1 18.6 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51L23 13.45a.84.84 0 0 1-.35.94z" />
    </svg>
  );
}

const PROVIDER_LABELS: Record<string, string> = {
  GITHUB: 'GitHub',
  GITLAB: 'GitLab',
};

export function GitProviderPanel(): React.ReactElement {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchProviders = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/git-providers');
      const data = await res.json();
      if (res.ok) setProviders(data.data ?? []);
    } catch {
      // non-fatal
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchProviders();

    // Show toast if OAuth just completed
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    const oauthError = params.get('oauth_error');
    if (connected || oauthError) {
      // Clean up query params without reload
      const clean = window.location.pathname;
      window.history.replaceState({}, '', clean);
    }
    if (oauthError) {
      setError(decodeURIComponent(oauthError));
    }
  }, [fetchProviders]);

  const handleDisconnect = async (provider: string): Promise<void> => {
    setDisconnecting(provider);
    setError(null);
    try {
      const res = await fetch(`/api/git-providers/${provider.toLowerCase()}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        setError(data?.error?.message ?? 'Failed to disconnect');
      } else {
        setProviders((prev) => prev.filter((p) => p.provider !== provider));
      }
    } catch {
      setError('Something went wrong');
    } finally {
      setDisconnecting(null);
    }
  };

  const connectedProviders = new Set(providers.map((p) => p.provider));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Git Connections</CardTitle>
        <CardDescription>
          Connect your GitHub or GitLab account to browse and deploy private repositories.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : (
          <>
            {/* GitHub */}
            <ProviderRow
              providerKey="GITHUB"
              label="GitHub"
              Icon={<Github className="h-5 w-5" />}
              connected={providers.find((p) => p.provider === 'GITHUB') ?? null}
              disconnecting={disconnecting === 'GITHUB'}
              onDisconnect={() => handleDisconnect('GITHUB')}
            />

            {/* GitLab */}
            <ProviderRow
              providerKey="GITLAB"
              label="GitLab"
              Icon={<GitLabIcon size={20} />}
              connected={providers.find((p) => p.provider === 'GITLAB') ?? null}
              disconnecting={disconnecting === 'GITLAB'}
              onDisconnect={() => handleDisconnect('GITLAB')}
            />

            {connectedProviders.size === 0 && (
              <p className="text-xs text-muted-foreground pt-1">
                No accounts connected yet. Connect an account to pick private repositories when creating projects.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ProviderRow({
  providerKey,
  label,
  Icon,
  connected,
  disconnecting,
  onDisconnect,
}: {
  providerKey: string;
  label: string;
  Icon: React.ReactElement;
  connected: ProviderInfo | null;
  disconnecting: boolean;
  onDisconnect: () => void;
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between rounded-lg border px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="text-muted-foreground">{Icon}</span>
        <div>
          <p className="text-sm font-medium">{label}</p>
          {connected ? (
            <div className="flex items-center gap-1.5 mt-0.5">
              {connected.avatarUrl && (
                <Image
                  src={connected.avatarUrl}
                  alt={connected.username}
                  width={16}
                  height={16}
                  className="rounded-full"
                  unoptimized
                />
              )}
              <span className="text-xs text-muted-foreground">@{connected.username}</span>
              <Badge variant="secondary" className="text-[10px] h-4 px-1.5">Connected</Badge>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Not connected</p>
          )}
        </div>
      </div>

      {connected ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={onDisconnect}
          disabled={disconnecting}
          className="text-muted-foreground hover:text-destructive"
        >
          {disconnecting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Link2Off className="h-4 w-4" />
          )}
          <span className="ml-1.5">{disconnecting ? 'Disconnecting…' : 'Disconnect'}</span>
        </Button>
      ) : (
        <Button variant="outline" size="sm" asChild>
          <a href={`/api/auth/${providerKey.toLowerCase()}/connect`}>
            <Link2 className="h-4 w-4 mr-1.5" />
            Connect {label}
          </a>
        </Button>
      )}
    </div>
  );
}
