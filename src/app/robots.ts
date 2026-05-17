import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001').replace(/\/$/, '');
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/explore', '/llms.txt', '/llms-full.txt', '/docs/'],
        disallow: ['/api/', '/dashboard/', '/login', '/reset-password'],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
