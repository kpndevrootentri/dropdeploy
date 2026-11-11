import { NextResponse } from 'next/server';
import { getWorkerHeartbeat } from '@/lib/worker-health';

/**
 * GET /api/health/worker
 * Returns the worker heartbeat status. No authentication required.
 * Response: { alive: true, pid, startedAt, timestamp, secondsAgo } or { alive: false }
 */
export async function GET(): Promise<NextResponse<unknown>> {
  return NextResponse.json(await getWorkerHeartbeat());
}
