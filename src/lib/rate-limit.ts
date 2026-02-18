import { NextResponse } from 'next/server';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const ENV_VAR_WINDOW_MS = 60_000; // 1 minute
const ENV_VAR_MAX_REQUESTS = 60; // 60 requests per minute per user

const store = new Map<string, RateLimitEntry>();

// Periodically clean expired entries to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.resetAt) {
      store.delete(key);
    }
  }
}, 60_000);

/**
 * In-memory rate limiter for env var API endpoints.
 * Returns a 429 NextResponse if the limit is exceeded, or null if allowed.
 */
export function checkEnvVarRateLimit(userId: string): NextResponse | null {
  const key = `env-var:${userId}`;
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + ENV_VAR_WINDOW_MS });
    return null;
  }

  entry.count++;

  if (entry.count > ENV_VAR_MAX_REQUESTS) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests. Please try again later.',
        },
      },
      {
        status: 429,
        headers: { 'Retry-After': String(retryAfter) },
      },
    );
  }

  return null;
}
