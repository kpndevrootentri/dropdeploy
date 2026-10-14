import Redis from 'ioredis';

const REDIS_HOST = process.env.REDIS_HOST ?? 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT ?? '6379', 10);
/**
 * Optional; matches Redis `requirepass`. Redis holds OAuth state, deploy
 * queues and rate-limit counters, and anything that can reach it unauthenticated
 * — a misbound port, a container that can see the host — can rewrite them.
 */
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

/**
 * Redis connection for BullMQ and caching.
 * Use getRedisConnection() in server/worker context only.
 */
export function createRedisConnection(): Redis {
  return new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
    password: REDIS_PASSWORD,
    maxRetriesPerRequest: null,
  });
}

let redis: Redis | null = null;

/**
 * Returns a shared Redis connection for the current process.
 * Call in API routes, server components, or workers.
 */
export function getRedisConnection(): Redis {
  if (!redis) {
    redis = createRedisConnection();
  }
  return redis;
}

/**
 * Closes the Redis connection. Call during graceful shutdown.
 */
export async function closeRedisConnection(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}
