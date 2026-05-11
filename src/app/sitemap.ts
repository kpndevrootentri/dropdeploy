import type { MetadataRoute } from 'next';
import { prisma } from '@/lib/prisma';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001').replace(/\/$/, '');

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
    ...showcases.map(({ project, updatedAt }) => ({
      url: `${base}/explore/${project.slug}`,
      lastModified: updatedAt,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
  ];
}
