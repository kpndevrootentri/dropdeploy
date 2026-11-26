import type { MetadataRoute } from 'next';
import { prisma } from '@/lib/prisma';
import { generateStaticParams as frameworkParams } from '@/app/docs/frameworks/[slug]/page';
import { SITE_URL } from '@/lib/json-ld';

// /docs itself is left out: it only redirects to /docs/getting-started.
const DOCS_PAGES: { path: string; priority: number }[] = [
  { path: '/docs/deploy-html', priority: 0.8 },
  { path: '/docs/claude-desktop', priority: 0.8 },
  { path: '/docs/claude-code', priority: 0.8 },
  { path: '/docs/cli', priority: 0.7 },
  { path: '/docs/api-tokens', priority: 0.7 },
  { path: '/docs/faq', priority: 0.8 },
  { path: '/docs/getting-started', priority: 0.8 },
  { path: '/docs/git-setup', priority: 0.6 },
  { path: '/docs/local-dev', priority: 0.5 },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = SITE_URL;

  let showcases: { project: { slug: string }; updatedAt: Date }[] = [];
  try {
    showcases = await prisma.projectShowcase.findMany({
      where: { isPublished: true },
      select: { project: { select: { slug: true } }, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    });
  } catch {
    // DB unavailable at build time — return static routes only
  }

  return [
    { url: base, lastModified: new Date(), changeFrequency: 'weekly', priority: 1.0 },
    { url: `${base}/explore`, lastModified: new Date(), changeFrequency: 'daily', priority: 0.9 },
    ...DOCS_PAGES.map(({ path, priority }) => ({ url: `${base}${path}`, changeFrequency: 'monthly' as const, priority })),
    ...frameworkParams().map(({ slug }) => ({
      url: `${base}/docs/frameworks/${slug}`,
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    })),
    ...showcases.map(({ project, updatedAt }) => ({
      url: `${base}/explore/${project.slug}`,
      lastModified: updatedAt,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
  ];
}
