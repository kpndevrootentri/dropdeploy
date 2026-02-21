/**
 * Structured logger built on Winston.
 * Usage:  import { createLogger } from '@/lib/logger';
 *         const log = createLogger('my-module');
 *         log.info('something happened', { key: 'value' });
 *
 * Log level is controlled by the LOG_LEVEL env var (default: 'info').
 * In development: colorised human-readable output.
 * In production:  newline-delimited JSON.
 */

import winston from 'winston';

const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';
const isDev = (process.env.NODE_ENV ?? 'development') !== 'production';

const devFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ level, message, timestamp, ns, ...meta }) => {
    const prefix = ns ? `[${ns}]` : '';
    const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    return `${timestamp} ${level}${prefix ? ' ' + prefix : ''}: ${message}${metaStr}`;
  }),
);

const prodFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.json(),
);

const rootLogger = winston.createLogger({
  level: LOG_LEVEL,
  format: isDev ? devFormat : prodFormat,
  transports: [new winston.transports.Console()],
});

export type Logger = ReturnType<typeof createLogger>;

/**
 * Creates a child logger scoped to a namespace (module/service name).
 * Optionally attach per-request metadata such as requestId.
 */
export function createLogger(
  namespace: string,
  defaultMeta?: Record<string, unknown>,
) {
  const child = rootLogger.child({ ns: namespace, ...defaultMeta });
  return {
    info: (message: string, meta?: Record<string, unknown>) =>
      child.info(message, meta),
    warn: (message: string, meta?: Record<string, unknown>) =>
      child.warn(message, meta),
    error: (message: string, meta?: Record<string, unknown>) =>
      child.error(message, meta),
    debug: (message: string, meta?: Record<string, unknown>) =>
      child.debug(message, meta),
  };
}
