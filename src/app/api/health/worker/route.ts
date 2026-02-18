import { NextResponse } from 'next/server';
import { getRedisConnection } from '@/lib/redis';

const HEARTBEAT_KEY = 'worker:health';

/**
 * GET /api/health/worker
 * Returns the worker heartbeat status. No authentication required.
 * Response: { alive: true, pid, startedAt, timestamp, secondsAgo } or { alive: false }
 */
export async function GET(): Promise<NextResponse<unknown>> {
  try {
    const raw = await getRedisConnection().get(HEARTBEAT_KEY);
    if (!raw) {
      return NextResponse.json({ alive: false });
    }
    const data = JSON.parse(raw) as { pid: number; startedAt: string; timestamp: string };
    const secondsAgo = Math.floor((Date.now() - new Date(data.timestamp).getTime()) / 1000);
    return NextResponse.json({ alive: true, ...data, secondsAgo });
  } catch {
    return NextResponse.json({ alive: false });
  }
}
