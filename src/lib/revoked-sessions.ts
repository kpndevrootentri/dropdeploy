import { getRedisConnection, withRedisTimeout } from '@/lib/redis';

/** Session JWT ids (`jti`) signed out before they expire. */
export interface IRevokedSessionStore {
  /** Remembers `jti` for `ttlSeconds` (the token's remaining lifetime), after which the entry is dropped. */
  add(jti: string, ttlSeconds: number): Promise<void>;
  has(jti: string): Promise<boolean>;
}

const key = (jti: string): string => `revoked-session:${jti}`;

/** Every authenticated request waits on this, so give up quickly while Redis is down. */
const TIMEOUT_MS = 500;

export const redisRevokedSessions: IRevokedSessionStore = {
  async add(jti, ttlSeconds) {
    await withRedisTimeout(getRedisConnection().set(key(jti), '1', 'EX', ttlSeconds), TIMEOUT_MS);
  },
  async has(jti) {
    const redis = getRedisConnection();
    // Known down: fail now instead of queueing a command that waits for the reconnect.
    if (redis.status === 'reconnecting' || redis.status === 'end') throw new Error(`Redis ${redis.status}`);
    return (await withRedisTimeout(redis.exists(key(jti)), TIMEOUT_MS)) === 1;
  },
};
