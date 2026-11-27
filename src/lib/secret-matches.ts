import { timingSafeEqual } from 'crypto';

/** Constant-time comparison of a shared secret. Only its length can leak, which is not secret. */
export function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
