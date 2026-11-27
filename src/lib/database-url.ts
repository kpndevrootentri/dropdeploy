import type { DbConfig } from './config';

/**
 * DATABASE_URL plus this process's Prisma pool size, pool wait and Postgres
 * statement timeout. Each is added only when the URL doesn't set it already, so
 * a value written into the URL wins. The new parameters are appended as text,
 * leaving the existing ones (schema=public, sslmode, ...) exactly as written.
 */
export function buildDatabaseUrl(url: string, db: DbConfig): string {
  const existing = new URL(url).searchParams;
  const added = [
    ['connection_limit', String(db.DB_CONNECTION_LIMIT)],
    ['pool_timeout', String(db.DB_POOL_TIMEOUT_SECONDS)],
    // Sent to Postgres at connection start, so it covers every query on every pooled connection.
    ['options', `-c statement_timeout=${db.DB_STATEMENT_TIMEOUT_MS}`],
  ]
    .filter(([key]) => !existing.has(key))
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`);
  if (added.length === 0) return url;
  return `${url}${url.includes('?') ? '&' : '?'}${added.join('&')}`;
}
