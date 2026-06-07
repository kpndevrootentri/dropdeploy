import { getConfig } from './config';

/** Returns the public URL for a deployed project slug (server-side). */
export function getDeployedProjectUrl(slug: string): string {
  const { BASE_DOMAIN, NEXT_PUBLIC_APP_URL, NODE_ENV } = getConfig();
  const isLocalDev = NODE_ENV !== 'production' && !!NEXT_PUBLIC_APP_URL?.includes('localhost');
  return isLocalDev
    ? `${NEXT_PUBLIC_APP_URL}/api/proxy/${slug}`
    : `${slug}.${BASE_DOMAIN}`;
}
