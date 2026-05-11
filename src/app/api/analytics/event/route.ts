import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionFromCookies } from '@/lib/get-session';

const ALLOWED_EVENTS = new Set([
  'deploy_triggered',
  'deploy_succeeded',
  'deploy_failed',
  'explore_view',
  'explore_click_live',
  'publish_flow_start',
  'publish_flow_done',
  'signup',
]);

/**
 * POST /api/analytics/event
 * Lightweight platform-level event tracking. No PII beyond optional userId.
 * Fire-and-forget from the client — always returns 200.
 */
export async function POST(req: NextRequest): Promise<NextResponse<unknown>> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = await req.json() as { event?: string; meta?: any };
    const { event, meta } = body;

    if (!event || !ALLOWED_EVENTS.has(event)) {
      return NextResponse.json({ success: false }, { status: 400 });
    }

    const session = await getSessionFromCookies().catch(() => null);

    // Non-blocking — don't await
    prisma.platformEvent.create({
      data: {
        event,
        userId: session?.userId ?? null,
        meta: meta ?? undefined,
      },
    }).catch(() => {});

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: true }); // always 200 — client fires-and-forgets
  }
}
