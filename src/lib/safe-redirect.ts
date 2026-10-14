/**
 * Returns `target` if it is a same-origin path, otherwise `fallback`.
 *
 * Used for post-login `?from=` redirects. Without it, `/login?from=https://evil.tld`
 * sends a user who has just typed their real password to a look-alike page.
 * `//evil.tld` and `/\evil.tld` are protocol-relative to browsers, so a leading
 * slash alone is not enough.
 */
export function safeRedirectPath(target: string | null | undefined, fallback = '/dashboard'): string {
  if (!target || !target.startsWith('/')) return fallback;
  if (target.startsWith('//') || target.startsWith('/\\')) return fallback;
  return target;
}
