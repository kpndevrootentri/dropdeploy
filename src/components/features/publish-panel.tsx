'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Check, Copy, ExternalLink, Globe, Loader2, Rocket } from 'lucide-react';
import { SHOWCASE_TAGS, type ShowcaseTag } from '@/services/showcase/showcase.service';

interface ProjectShowcase {
  id: string;
  shortDescription: string;
  tags: string[];
  liveUrl: string | null;
  repoUrl: string | null;
  contactUrl: string | null;
  isPublished: boolean;
  publishedAt: string | null;
  viewCount: number;
}

interface PublishPanelProps {
  projectId: string;
  projectName: string;
  projectSlug: string;
  defaultLiveUrl?: string;
  defaultRepoUrl?: string;
}

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

export function PublishPanel({
  projectId,
  projectSlug,
  defaultLiveUrl = '',
  defaultRepoUrl = '',
}: PublishPanelProps): React.ReactElement {
  const [showcase, setShowcase] = useState<ProjectShowcase | null>(null);
  const [loading, setLoading] = useState(true);

  const [shortDescription, setShortDescription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [liveUrl, setLiveUrl] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [contactUrl, setContactUrl] = useState('');
  const [isPublished, setIsPublished] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<'published' | 'draft' | 'unpublished' | null>(null);
  const [copied, setCopied] = useState(false);

  const exploreUrl = `/explore/${projectSlug}`;

  useEffect(() => {
    fetch(`/api/projects/${projectId}/showcase`)
      .then((r) => r.json())
      .then((res: { success: boolean; data?: ProjectShowcase }) => {
        if (res.success && res.data) {
          const s = res.data;
          setShowcase(s);
          setShortDescription(s.shortDescription);
          setTags(s.tags);
          setLiveUrl(s.liveUrl ?? defaultLiveUrl);
          setRepoUrl(s.repoUrl ?? defaultRepoUrl);
          setContactUrl(s.contactUrl ?? '');
          setIsPublished(s.isPublished);
        } else {
          setLiveUrl(defaultLiveUrl);
          setRepoUrl(defaultRepoUrl);
        }
      })
      .catch(() => {
        setLiveUrl(defaultLiveUrl);
        setRepoUrl(defaultRepoUrl);
      })
      .finally(() => setLoading(false));
  }, [projectId, defaultLiveUrl, defaultRepoUrl]);

  const toggleTag = (tag: string): void => {
    setTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : prev.length < 3 ? [...prev, tag] : prev
    );
  };

  const handleSave = async (publish: boolean): Promise<void> => {
    setSaveError(null);
    setLastSaved(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/showcase`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shortDescription: shortDescription.trim(),
          tags,
          liveUrl: liveUrl.trim() || null,
          repoUrl: repoUrl.trim() || null,
          contactUrl: contactUrl.trim() || null,
          isPublished: publish,
        }),
      });
      const data = await res.json() as { success: boolean; data?: ProjectShowcase; error?: { message: string } };
      if (!res.ok) {
        setSaveError(data.error?.message ?? 'Failed to save');
      } else {
        setShowcase(data.data ?? null);
        setIsPublished(publish);
        const outcome = publish ? 'published' : isPublished ? 'unpublished' : 'draft';
        setLastSaved(outcome);
        setTimeout(() => setLastSaved(null), 2500);
      }
    } catch {
      setSaveError('Something went wrong');
    } finally {
      setSaving(false);
    }
  };

  const handleCopyLink = (): void => {
    const url = `${window.location.origin}${exploreUrl}`;
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const canPublish = shortDescription.trim().length > 0 && tags.length > 0;

  return (
    <div className="space-y-6">
      {/* Published status banner */}
      {isPublished && (
        <div className="flex items-center gap-3 rounded-lg border border-green-500/30 bg-green-50/50 dark:bg-green-950/20 px-4 py-3">
          <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-green-700 dark:text-green-400">
              Listed on Explore
            </p>
            <p className="text-xs text-muted-foreground truncate">{`${typeof window !== 'undefined' ? window.location.origin : ''}/explore/${projectSlug}`}</p>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCopyLink} title="Copy link">
              {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
              <a href={exploreUrl} target="_blank" rel="noopener noreferrer" title="View public page">
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
          </div>
        </div>
      )}

      {/* View count */}
      {showcase && showcase.viewCount > 0 && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Globe className="h-4 w-4" />
          <span>{showcase.viewCount.toLocaleString()} view{showcase.viewCount !== 1 ? 's' : ''}</span>
        </div>
      )}

      {/* Publication form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Showcase Details</CardTitle>
          <CardDescription>
            Tell others what your tool does. This appears on the public Explore page.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Short description */}
          <div className="space-y-2">
            <Label htmlFor="pub-desc">
              Short description <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="pub-desc"
              value={shortDescription}
              onChange={(e) => setShortDescription(e.target.value.slice(0, 140))}
              rows={2}
              placeholder="A one-liner that tells visitors what your tool does…"
              maxLength={140}
            />
            <p className={cn('text-xs', shortDescription.length >= 130 ? 'text-yellow-500' : 'text-muted-foreground')}>
              {shortDescription.length}/140
            </p>
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <Label>
              Tags <span className="text-destructive">*</span>{' '}
              <span className="text-muted-foreground font-normal">(pick up to 3)</span>
            </Label>
            <div className="flex flex-wrap gap-2">
              {SHOWCASE_TAGS.map((tag) => {
                const selected = tags.includes(tag);
                const disabled = !selected && tags.length >= 3;
                return (
                  <button
                    key={tag}
                    type="button"
                    disabled={disabled}
                    onClick={() => toggleTag(tag)}
                    className={cn(
                      'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                      selected
                        ? 'border-primary bg-primary text-primary-foreground'
                        : disabled
                          ? 'border-border bg-muted text-muted-foreground opacity-40 cursor-not-allowed'
                          : 'border-border bg-background hover:bg-muted text-foreground'
                    )}
                  >
                    {TAG_LABELS[tag]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Links */}
          <div className="space-y-3">
            <Label>Links</Label>

            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Live URL</p>
              <Input
                value={liveUrl}
                onChange={(e) => setLiveUrl(e.target.value)}
                placeholder="https://your-tool.domain.in"
              />
            </div>

            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Repository URL</p>
              <Input
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/you/repo"
              />
            </div>

            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Contact / Support URL <span className="text-muted-foreground/60">(optional)</span></p>
              <Input
                value={contactUrl}
                onChange={(e) => setContactUrl(e.target.value)}
                placeholder="https://your-contact-page.com"
              />
            </div>
          </div>

          {saveError && (
            <p className="text-sm text-destructive" role="alert">{saveError}</p>
          )}

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button
              onClick={() => { void handleSave(true); }}
              disabled={saving || !canPublish}
            >
              {saving ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</>
              ) : lastSaved === 'published' ? (
                <><Check className="mr-2 h-4 w-4" />{isPublished ? 'Updated' : 'Published'}</>
              ) : (
                <><Rocket className="mr-2 h-4 w-4" />{isPublished ? 'Update listing' : 'Publish to Explore'}</>
              )}
            </Button>

            <Button
              variant="outline"
              onClick={() => { void handleSave(false); }}
              disabled={saving || !canPublish}
            >
              {lastSaved === 'draft' ? (
                <><Check className="mr-2 h-4 w-4 text-green-600" />Draft saved</>
              ) : lastSaved === 'unpublished' ? (
                <><Check className="mr-2 h-4 w-4" />Unpublished</>
              ) : isPublished ? (
                'Unpublish'
              ) : (
                'Save draft'
              )}
            </Button>

            {!canPublish && (
              <p className="text-xs text-muted-foreground">
                {shortDescription.trim().length === 0
                  ? 'Add a description to publish'
                  : 'Select at least one tag'}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Preview card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Preview</CardTitle>
          <CardDescription>How your listing looks on the Explore page.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border bg-card p-4 space-y-3 max-w-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-sm truncate">{shortDescription || <span className="text-muted-foreground italic">Your short description…</span>}</p>
              </div>
              {isPublished && (
                <Badge variant="secondary" className="shrink-0 text-xs">Live</Badge>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {tags.length > 0
                ? tags.map((t) => (
                    <Badge key={t} variant="outline" className="text-xs font-normal">
                      {TAG_LABELS[t as ShowcaseTag] ?? t}
                    </Badge>
                  ))
                : <span className="text-xs text-muted-foreground">No tags yet</span>
              }
            </div>
            {liveUrl && (
              <p className="text-xs text-muted-foreground truncate">{liveUrl}</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
