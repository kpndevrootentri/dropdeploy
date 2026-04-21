import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FrameworkLogo, FRAMEWORK_CONFIG } from '@/components/ui/framework-logo';
import { showcaseService, type ShowcaseTag } from '@/services/showcase/showcase.service';
import { getSessionFromCookies } from '@/lib/get-session';
import { ArrowLeft, ExternalLink, Github, Globe, Mail } from 'lucide-react';

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
  params: Promise<{ slug: string }>;
}

export const revalidate = 30;

export default async function ExploreToolPage({ params }: PageProps) {
  const { slug } = await params;

  const [session, showcaseResult] = await Promise.all([
    getSessionFromCookies(),
    showcaseService.getPublicBySlug(slug).catch(() => null),
  ]);

  const showcase = showcaseResult;
  if (!showcase) notFound();

  const fw = showcase.project.type as keyof typeof FRAMEWORK_CONFIG;
  const config = FRAMEWORK_CONFIG[fw] ?? FRAMEWORK_CONFIG.STATIC;
  const { Logo } = config;
  const ownerHandle = showcase.project.user.email.split('@')[0];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-background/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <Link href="/explore" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" />
            Explore
          </Link>
          <Link href="/" className="text-sm font-semibold tracking-tight">
            DropDeploy
          </Link>
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

      <main className="max-w-3xl mx-auto px-4 py-12 space-y-8">
        {/* Tool header */}
        <div className="flex items-start gap-4">
          <div className="shrink-0 mt-1">
            <Logo size={40} />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <h1 className="text-2xl font-bold tracking-tight">{showcase.project.name}</h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span>by {ownerHandle}</span>
              <span>&middot;</span>
              <span>{config.label}</span>
              {showcase.viewCount > 0 && (
                <>
                  <span>&middot;</span>
                  <span>{showcase.viewCount.toLocaleString()} view{showcase.viewCount !== 1 ? 's' : ''}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Tags */}
        <div className="flex flex-wrap gap-2">
          {showcase.tags.map((t) => (
            <Link key={t} href={`/explore?tag=${t}`}>
              <Badge variant="secondary" className="text-xs px-3 py-1 cursor-pointer hover:bg-secondary/80">
                {TAG_LABELS[t as ShowcaseTag] ?? t}
              </Badge>
            </Link>
          ))}
        </div>

        {/* Description */}
        <p className="text-base text-foreground leading-relaxed">
          {showcase.shortDescription}
        </p>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-3">
          {showcase.liveUrl && (
            <Button asChild>
              <a href={showcase.liveUrl} target="_blank" rel="noopener noreferrer">
                <Globe className="mr-2 h-4 w-4" />
                Visit Tool
                <ExternalLink className="ml-2 h-3.5 w-3.5" />
              </a>
            </Button>
          )}
          {showcase.repoUrl && (
            <Button variant="outline" asChild>
              <a href={showcase.repoUrl} target="_blank" rel="noopener noreferrer">
                <Github className="mr-2 h-4 w-4" />
                Source
                <ExternalLink className="ml-2 h-3.5 w-3.5" />
              </a>
            </Button>
          )}
          {showcase.contactUrl && (
            <Button variant="ghost" asChild>
              <a href={showcase.contactUrl} target="_blank" rel="noopener noreferrer">
                <Mail className="mr-2 h-4 w-4" />
                Contact
              </a>
            </Button>
          )}
        </div>

        {/* Meta card */}
        <div className="rounded-xl border bg-muted/30 p-5 space-y-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Details</p>
          <div className="grid gap-3 sm:grid-cols-2 text-sm">
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Framework</p>
              <div className="flex items-center gap-2">
                <Logo size={16} />
                <span>{config.label}</span>
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Built by</p>
              <span>{ownerHandle}</span>
            </div>
            {showcase.publishedAt && (
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Published</p>
                <span>
                  {new Date(showcase.publishedAt).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>
              </div>
            )}
          </div>
        </div>

      </main>
    </div>
  );
}
