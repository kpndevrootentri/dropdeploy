import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/json-ld';

export default function robots(): MetadataRoute.Robots {
  const base = SITE_URL;
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/explore', '/llms.txt', '/llms-full.txt', '/docs/', '/downloads/', '/deploy.md'],
        disallow: ['/api/', '/dashboard/', '/login', '/reset-password', '/invite/'],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
