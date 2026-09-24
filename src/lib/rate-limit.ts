import { NextResponse, type NextRequest } from 'next/server';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const ENV_VAR_WINDOW_MS = 60_000; // 1 minute
const ENV_VAR_MAX_REQUESTS = 60; // 60 requests per minute per user

const WEBHOOK_WINDOW_MS = 60_000; // 1 minute
const WEBHOOK_MAX_REQUESTS = 60; // 60 deliveries per minute per source

// NOTE: this store is in-memory and per-process. It does NOT span multiple
// instances or survive a restart. Fine for a single-instance deployment; if
// DropDeploy is scaled horizontally, back this with Redis (getRedisConnection).
const store = new Map<string, RateLimitEntry>();

// Periodically clean expired entries to prevent memory leaks.
// unref() so this timer never by itself keeps the process alive: a long-lived
// server ignores it, while a short-lived one (a test run, a script) can still
// exit instead of hanging on the sweep.
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.resetAt) {
      store.delete(key);
    }
  }
}, 60_000);
sweep.unref?.();

/**
 * Generic in-memory fixed-window rate limiter.
 * Returns a 429 NextResponse if the limit is exceeded, or null if allowed.
 */
export function checkRateLimit(key: string, opts: { windowMs: number; max: number }): NextResponse | null {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + opts.windowMs });
    return null;
  }

  entry.count++;

  if (entry.count > opts.max) {
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

/** Rate limit env var API endpoints — 60 req/min/user. */
export function checkEnvVarRateLimit(userId: string): NextResponse | null {
  return checkRateLimit(`env-var:${userId}`, { windowMs: ENV_VAR_WINDOW_MS, max: ENV_VAR_MAX_REQUESTS });
}

/** Rate limit the public webhook endpoint — 60 deliveries/min keyed by source (IP/repo). */
export function checkWebhookRateLimit(source: string): NextResponse | null {
  return checkRateLimit(`webhook:${source}`, { windowMs: WEBHOOK_WINDOW_MS, max: WEBHOOK_MAX_REQUESTS });
}

const DOMAIN_MUTATION_WINDOW_MS = 60_000; // 1 minute
const DOMAIN_MUTATION_MAX = 20; // 20 add/patch calls per minute per user

const DOMAIN_VERIFY_WINDOW_MS = 60_000; // 1 minute
const DOMAIN_VERIFY_MAX = 6; // 6 manual DNS checks per minute per user

const TLS_ASK_WINDOW_MS = 60_000; // 1 minute
const TLS_ASK_MAX = 5; // matches Caddy's own on-demand burst

/** Rate limit custom-domain add/update — 20 req/min/user. */
export function checkDomainMutationRateLimit(userId: string): NextResponse | null {
  return checkRateLimit(`domain:${userId}`, {
    windowMs: DOMAIN_MUTATION_WINDOW_MS,
    max: DOMAIN_MUTATION_MAX,
  });
}

/**
 * Rate limit manual DNS verification — 6 req/min/user.
 * Tighter than the other mutations because each call fans out to several
 * outbound DNS queries against a hostname the user chose.
 */
export function checkDomainVerifyRateLimit(userId: string): NextResponse | null {
  return checkRateLimit(`domain-verify:${userId}`, {
    windowMs: DOMAIN_VERIFY_WINDOW_MS,
    max: DOMAIN_VERIFY_MAX,
  });
}

/**
 * Rate limit the Caddy ask endpoint, keyed by the hostname being asked about.
 * Bounds how fast a single hostname can drive certificate orders, which is what
 * protects the shared Let's Encrypt quota.
 */
export function checkTlsAskRateLimit(hostname: string): NextResponse | null {
  return checkRateLimit(`tls-ask:${hostname.toLowerCase()}`, {
    windowMs: TLS_ASK_WINDOW_MS,
    max: TLS_ASK_MAX,
  });
}

/**
 * The client IP, as set by the TLS edge.
 *
 * `X-Real-IP` is written by Caddy (and nginx) from the connection's own peer
 * address, overwriting anything the client sent, whereas the first
 * `X-Forwarded-For` entry is whatever the client chose to put there. The app
 * listens on loopback only, so the edge is the only way in and the header
 * cannot be forged by connecting to the app directly.
 */
export function getClientIp(req: NextRequest): string {
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}

const LOGIN_IP_WINDOW_MS = 60_000; // 1 minute
const LOGIN_IP_MAX = 20; // 20 attempts per minute per IP

const LOGIN_ACCOUNT_WINDOW_MS = 15 * 60_000; // 15 minutes
const LOGIN_ACCOUNT_MAX = 20; // 20 attempts per 15 minutes per account

const REGISTER_WINDOW_MS = 60 * 60_000; // 1 hour
const REGISTER_MAX = 5; // 5 sign-ups per hour per IP

const PASSWORD_CHANGE_WINDOW_MS = 15 * 60_000; // 15 minutes
const PASSWORD_CHANGE_MAX = 10; // 10 attempts per 15 minutes per user

/**
 * Rate limit password sign-in (browser login and CLI token) — per IP, to slow
 * credential stuffing, and per account, to slow guessing one password from
 * many IPs. The per-account cap is deliberately loose: every attempt counts,
 * so a tight one would let anyone lock a user out by failing on purpose.
 */
export function checkLoginRateLimit(ip: string, email: string): NextResponse | null {
  return (
    checkRateLimit(`login-ip:${ip}`, { windowMs: LOGIN_IP_WINDOW_MS, max: LOGIN_IP_MAX }) ??
    checkRateLimit(`login-account:${email.trim().toLowerCase()}`, {
      windowMs: LOGIN_ACCOUNT_WINDOW_MS,
      max: LOGIN_ACCOUNT_MAX,
    })
  );
}

/** Rate limit account registration — 5 per hour per IP. */
export function checkRegisterRateLimit(ip: string): NextResponse | null {
  return checkRateLimit(`register:${ip}`, { windowMs: REGISTER_WINDOW_MS, max: REGISTER_MAX });
}

/** Rate limit password changes, which verify the current password — 10 per 15 min per user. */
export function checkPasswordChangeRateLimit(userId: string): NextResponse | null {
  return checkRateLimit(`password-change:${userId}`, {
    windowMs: PASSWORD_CHANGE_WINDOW_MS,
    max: PASSWORD_CHANGE_MAX,
  });
}
