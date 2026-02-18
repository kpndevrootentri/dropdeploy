'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Loader2,
  Check,
  AlertTriangle,
  Lock,
  Globe,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EnvEnvironment = 'ALL' | 'DEVELOPMENT' | 'STAGING' | 'PRODUCTION';

interface EnvVar {
  id: string;
  key: string;
  environment: EnvEnvironment;
  createdAt: string;
  updatedAt: string;
}

const ENV_OPTIONS: { value: EnvEnvironment; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'DEVELOPMENT', label: 'Development' },
  { value: 'STAGING', label: 'Staging' },
  { value: 'PRODUCTION', label: 'Production' },
];

// ---------------------------------------------------------------------------
// EnvVarRow
// ---------------------------------------------------------------------------

function EnvVarRow({
  envVar,
  projectId,
  onDeleted,
  onUpdated,
}: {
  envVar: EnvVar;
  projectId: string;
  onDeleted: () => void;
  onUpdated: () => void;
}): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [newValue, setNewValue] = useState('');
  const [showValue, setShowValue] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPublic = envVar.key.startsWith('NEXT_PUBLIC_');

  const handleUpdate = async (): Promise<void> => {
    if (!newValue) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/env-vars/${envVar.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: newValue }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data?.error?.message ?? 'Failed to update');
      } else {
        setEditing(false);
        setNewValue('');
        onUpdated();
      }
    } catch {
      setError('Something went wrong');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/env-vars/${envVar.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data?.error?.message ?? 'Failed to delete');
      } else {
        onDeleted();
      }
    } catch {
      setError('Something went wrong');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="group border rounded-lg px-4 py-3 space-y-2">
      <div className="flex items-center gap-3">
        {/* Key */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <code className="text-sm font-mono font-medium truncate">{envVar.key}</code>
          {isPublic ? (
            <Badge variant="outline" className="shrink-0 text-xs gap-1 text-blue-600 border-blue-300">
              <Globe className="h-3 w-3" />
              Public
            </Badge>
          ) : (
            <Badge variant="outline" className="shrink-0 text-xs gap-1 text-muted-foreground">
              <Lock className="h-3 w-3" />
              Secret
            </Badge>
          )}
          {envVar.environment !== 'ALL' && (
            <Badge variant="secondary" className="shrink-0 text-xs">
              {envVar.environment.charAt(0) + envVar.environment.slice(1).toLowerCase()}
            </Badge>
          )}
        </div>

        {/* Value display */}
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-muted-foreground font-mono">
            {showValue ? '(stored encrypted)' : '••••••••'}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setShowValue(!showValue)}
            title={showValue ? 'Hide indicator' : 'Show indicator'}
          >
            {showValue ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </Button>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => {
              setEditing(!editing);
              setError(null);
              setNewValue('');
            }}
          >
            {editing ? 'Cancel' : 'Update'}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={handleDelete}
            disabled={deleting}
            title="Delete variable"
          >
            {deleting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>

      {/* Edit form */}
      {editing && (
        <div className="flex items-center gap-2 pl-0">
          <Input
            type="password"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder="Enter new value"
            className="flex-1 font-mono text-sm h-8"
            autoFocus
          />
          <Button
            size="sm"
            className="h-8"
            onClick={handleUpdate}
            disabled={saving || !newValue}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
          </Button>
        </div>
      )}

      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AddEnvVarForm
// ---------------------------------------------------------------------------

function AddEnvVarForm({
  projectId,
  onCreated,
}: {
  projectId: string;
  onCreated: () => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [environment, setEnvironment] = useState<EnvEnvironment>('ALL');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPublic = key.startsWith('NEXT_PUBLIC_');

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!key.trim() || !value) return;

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/env-vars`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: key.trim(),
          value,
          environment,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data?.error?.message ?? 'Failed to create');
      } else {
        setKey('');
        setValue('');
        setEnvironment('ALL');
        setOpen(false);
        onCreated();
      }
    } catch {
      setError('Something went wrong');
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-1.5"
      >
        <Plus className="h-3.5 w-3.5" />
        Add variable
      </Button>
    );
  }

  return (
    <Card>
      <CardContent className="pt-4">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="env-key" className="text-xs">Key</Label>
              <Input
                id="env-key"
                value={key}
                onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
                placeholder="MY_SECRET_KEY"
                className="font-mono text-sm h-8"
                autoFocus
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="env-value" className="text-xs">Value</Label>
              <Input
                id="env-value"
                type="password"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="secret_value"
                className="font-mono text-sm h-8"
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="env-environment" className="text-xs">Environment</Label>
            <select
              id="env-environment"
              value={environment}
              onChange={(e) => setEnvironment(e.target.value as EnvEnvironment)}
              className={cn(
                'flex h-8 w-full max-w-[200px] rounded-md border border-input bg-background px-3 text-sm',
                'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              )}
            >
              {ENV_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {isPublic && (
            <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30 px-3 py-2">
              <AlertTriangle className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
              <div className="text-xs text-blue-700 dark:text-blue-400">
                <span className="font-medium">NEXT_PUBLIC_</span> variables are injected at build time and will be
                visible in client-side JavaScript bundles. Do not store secrets in public variables.
              </div>
            </div>
          )}

          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}

          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={saving || !key.trim() || !value}>
              {saving ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <Check className="mr-1.5 h-3.5 w-3.5" />
                  Add
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setOpen(false);
                setError(null);
                setKey('');
                setValue('');
                setEnvironment('ALL');
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// EnvVarsPanel (exported)
// ---------------------------------------------------------------------------

export function EnvVarsPanel({
  projectId,
}: {
  projectId: string;
}): React.ReactElement {
  const [envVars, setEnvVars] = useState<EnvVar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEnvVars = useCallback(() => {
    setError(null);
    fetch(`/api/projects/${projectId}/env-vars`)
      .then((res) => res.json())
      .then((data) => {
        if (data?.success && data.data) {
          setEnvVars(data.data);
        } else {
          setError(data?.error?.message ?? 'Failed to load');
        }
      })
      .catch(() => setError('Failed to load environment variables'))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    fetchEnvVars();
  }, [fetchEnvVars]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Environment Variables</CardTitle>
              <CardDescription>
                Secrets are encrypted at rest and injected at container runtime. They are never
                baked into Docker images.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <p className="text-sm text-destructive py-4">{error}</p>
          ) : envVars.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Lock className="h-8 w-8 text-muted-foreground/40 mb-2" />
              <p className="text-sm text-muted-foreground">No environment variables</p>
              <p className="text-xs text-muted-foreground mt-1">
                Add your first variable to get started.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {envVars.map((envVar) => (
                <EnvVarRow
                  key={envVar.id}
                  envVar={envVar}
                  projectId={projectId}
                  onDeleted={fetchEnvVars}
                  onUpdated={fetchEnvVars}
                />
              ))}
            </div>
          )}

          <div className="pt-2">
            <AddEnvVarForm projectId={projectId} onCreated={fetchEnvVars} />
          </div>
        </CardContent>
      </Card>

      {/* Info card */}
      <Card className="border-blue-200 dark:border-blue-800">
        <CardHeader>
          <CardTitle className="text-sm text-blue-600 dark:text-blue-400">
            How environment variables work
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-2">
          <p>
            <span className="font-medium text-foreground">Secret variables</span> (without NEXT_PUBLIC_ prefix) are injected
            at runtime via the Docker API. They never appear in image layers or build logs.
          </p>
          <p>
            <span className="font-medium text-foreground">Public variables</span> (NEXT_PUBLIC_*) are passed as build
            arguments for Next.js projects. They are bundled into client-side JavaScript and are
            visible to end users.
          </p>
          <p>
            <span className="font-medium text-foreground">Environment scoping:</span> Variables
            set to &quot;All&quot; apply everywhere. Environment-specific values override the &quot;All&quot; fallback during
            deployment.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
