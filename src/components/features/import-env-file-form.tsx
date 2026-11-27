'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { checkEnvFile, MAX_BULK_ENV_VARS, MAX_ENV_FILE_LENGTH } from '@/validators/env-var.validator';
import { Loader2, Check } from 'lucide-react';
import { EnvironmentSelect, type EnvEnvironment, type EnvVar } from './env-vars-panel';

type PreviewRow = { line: number; key?: string; status: 'new' | 'overwrite' | 'invalid'; reason?: string };

export function ImportEnvFileForm({
  projectId,
  envVars,
  onSaved,
  onClose,
}: {
  projectId: string;
  /** null while the list is loading or failed to load: overwrites can't be shown, so Save stays off. */
  envVars: EnvVar[] | null;
  onSaved: () => void;
  onClose: () => void;
}): React.ReactElement {
  const [content, setContent] = useState('');
  const [environment, setEnvironment] = useState<EnvEnvironment>('ALL');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The same check the server runs, so the preview shows what saving will do.
  const { variables, invalid, tooMany } = useMemo(() => checkEnvFile(content), [content]);
  const rows = useMemo<PreviewRow[]>(() => {
    const existing = new Set((envVars ?? []).filter((v) => v.environment === environment).map((v) => v.key));
    return [
      ...variables.map((v): PreviewRow => ({ line: v.line, key: v.key, status: existing.has(v.key) ? 'overwrite' : 'new' })),
      ...invalid.map((p): PreviewRow => ({ ...p, status: 'invalid' })),
    ].sort((a, b) => a.line - b.line);
  }, [variables, invalid, envVars, environment]);
  const overwrites = rows.filter((r) => r.status === 'overwrite').length;
  const count = `${variables.length} variable${variables.length === 1 ? '' : 's'}`;
  const canSave = envVars !== null && variables.length > 0 && invalid.length === 0 && !tooMany && !saving;

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = ''; // picking the same file again still loads it
    if (!file) return;
    if (file.size > MAX_ENV_FILE_LENGTH) {
      setError('That file is too large for a .env file');
      return;
    }
    setError(null);
    setContent(await file.text());
  };

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/env-vars/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, environment }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error?.message ?? 'Failed to save');
      } else {
        onSaved();
        onClose();
      }
    } catch {
      setError('Something went wrong');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="env-file-content" className="text-xs">Paste a .env file</Label>
          <Textarea
            id="env-file-content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={8}
            placeholder={'DATABASE_URL=postgres://...\nAPI_KEY="secret"'}
            className="font-mono text-xs"
            spellCheck={false}
            autoFocus
          />
          <Input
            type="file"
            aria-label="Load a .env file"
            className="max-w-xs text-xs h-8"
            onChange={handleFile}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="env-file-environment" className="text-xs">Environment</Label>
          <EnvironmentSelect id="env-file-environment" value={environment} onChange={setEnvironment} />
        </div>

        {rows.length > 0 && (
          <div className="space-y-1.5" data-testid="env-file-preview">
            <p className="text-xs text-muted-foreground">
              {tooMany ? `More than ${MAX_BULK_ENV_VARS} variables` : count}
              {overwrites > 0 && `, ${overwrites} will overwrite existing`}
              {invalid.length > 0 && `, ${invalid.length} invalid (fix them to save)`}
            </p>
            <ul className="max-h-64 overflow-y-auto divide-y rounded-md border">
              {rows.map((row) => (
                <li key={`${row.line}-${row.key ?? ''}`} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                  <span className="w-10 shrink-0 text-muted-foreground tabular-nums">L{row.line}</span>
                  <code className="min-w-0 font-mono font-medium truncate">{row.key ?? '—'}</code>
                  {row.status === 'invalid' ? (
                    <span className="ml-auto min-w-0 text-destructive text-right">{row.reason}</span>
                  ) : (
                    <>
                      <span className="hidden sm:inline shrink-0 text-muted-foreground font-mono">••••••••</span>
                      <Badge
                        variant="outline"
                        className={cn(
                          'ml-auto shrink-0 text-xs',
                          row.status === 'new' ? 'text-green-600 border-green-300' : 'text-amber-600 border-amber-300',
                        )}
                      >
                        {row.status === 'new' ? 'New' : 'Overwrites existing'}
                      </Badge>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {tooMany && (
          <p className="text-xs text-destructive">
            At most {MAX_BULK_ENV_VARS} variables at a time.
          </p>
        )}
        {error && <p className="text-xs text-destructive" role="alert">{error}</p>}

        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleSave} disabled={!canSave}>
            {saving ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Check className="mr-1.5 h-3.5 w-3.5" />
                Save{tooMany ? '' : ` ${count}`}
              </>
            )}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
