import { getRedisConnection } from '@/lib/redis';

/** Written by the deployment worker every 30s with a 90s TTL (src/workers/deployment.worker.ts). */
const HEARTBEAT_KEY = 'worker:health';

export type WorkerHeartbeat =
  | { alive: false }
  | { alive: true; pid: number; startedAt: string; timestamp: string; secondsAgo: number };

/** The deployment worker's last heartbeat. Never throws: an unreachable Redis reads as a dead worker. */
export async function getWorkerHeartbeat(): Promise<WorkerHeartbeat> {
  try {
    const raw = await getRedisConnection().get(HEARTBEAT_KEY);
    if (!raw) return { alive: false };
    const data = JSON.parse(raw) as { pid: number; startedAt: string; timestamp: string };
    const secondsAgo = Math.floor((Date.now() - new Date(data.timestamp).getTime()) / 1000);
    return { alive: true, ...data, secondsAgo };
  } catch {
    return { alive: false };
  }
}
