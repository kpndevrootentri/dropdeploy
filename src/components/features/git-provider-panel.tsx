'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Link2, Link2Off, Github, AlertCircle } from 'lucide-react';

const POPUP_WIDTH = 600;
const POPUP_HEIGHT = 700;

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
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const popupRef = useRef<Window | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

    // Handle non-popup OAuth redirect (fallback)
    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get('oauth_error');
    if (params.get('connected') || oauthError) {
      window.history.replaceState({}, '', window.location.pathname);
    }
    if (oauthError) setError(decodeURIComponent(oauthError));
  }, [fetchProviders]);

  // Listen for postMessage from OAuth popup
  useEffect(() => {
    const handler = (event: MessageEvent): void => {
      const msg = event.data as { type?: string; provider?: string; error?: string };
      if (msg.type === 'oauth_success') {
        setConnecting(null);
        setError(null);
        if (pollRef.current) clearInterval(pollRef.current);
        void fetchProviders();
      } else if (msg.type === 'oauth_error') {
        setConnecting(null);
        setError(msg.error ?? 'Failed to connect account');
        if (pollRef.current) clearInterval(pollRef.current);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [fetchProviders]);

  const openConnectPopup = (provider: string): void => {
    setError(null);
    setConnecting(provider);
    const left = window.screenX + (window.outerWidth - POPUP_WIDTH) / 2;
    const top = window.screenY + (window.outerHeight - POPUP_HEIGHT) / 2;
    const popup = window.open(
      `/api/auth/${provider.toLowerCase()}/connect?popup=1`,
      `connect_${provider}`,
      `width=${POPUP_WIDTH},height=${POPUP_HEIGHT},left=${left},top=${top}`,
    );
    popupRef.current = popup;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      if (popup?.closed) {
        clearInterval(pollRef.current!);
        setConnecting(null);
        void fetchProviders();
      }
    }, 500);
  };

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
              connecting={connecting === 'GITHUB'}
              onConnect={() => openConnectPopup('GITHUB')}
              onDisconnect={() => handleDisconnect('GITHUB')}
            />

            {/* GitLab */}
            <ProviderRow
              providerKey="GITLAB"
              label="GitLab"
              Icon={<GitLabIcon size={20} />}
              connected={providers.find((p) => p.provider === 'GITLAB') ?? null}
              disconnecting={disconnecting === 'GITLAB'}
              connecting={connecting === 'GITLAB'}
              onConnect={() => openConnectPopup('GITLAB')}
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
  label,
  Icon,
  connected,
  disconnecting,
  connecting,
  onConnect,
  onDisconnect,
}: {
  providerKey: string;
  label: string;
  Icon: React.ReactElement;
  connected: ProviderInfo | null;
  disconnecting: boolean;
  connecting: boolean;
  onConnect: () => void;
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
            <p className="text-xs text-muted-foreground">
              {connecting ? 'Complete in popup…' : 'Not connected'}
            </p>
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
        <Button
          variant="outline"
          size="sm"
          onClick={onConnect}
          disabled={connecting}
        >
          {connecting ? (
            <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
          ) : (
            <Link2 className="h-4 w-4 mr-1.5" />
          )}
          {connecting ? 'Connecting…' : `Connect ${label}`}
        </Button>
      )}
    </div>
  );
}
