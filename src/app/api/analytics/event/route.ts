import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';
import { getSessionFromCookies } from '@/lib/get-session';
import { checkAnalyticsEventRateLimit, getClientIp } from '@/lib/rate-limit';

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

/** Largest request body accepted, in bytes. Events are a name and a few tags. */
const MAX_BODY_BYTES = 2048;

/**
 * `meta` is a small flat bag of tags — at most 10 keys, short keys, and
 * primitive values with strings capped. The endpoint takes anonymous writes,
 * so an unbounded JSON column would let anyone fill the database.
 */
const metaSchema = z
  .record(z.string().max(40), z.union([z.string().max(200), z.number(), z.boolean(), z.null()]))
  .refine((m) => Object.keys(m).length <= 10, 'Too many meta keys')
  .optional();

const eventSchema = z.object({
  event: z.string().refine((e) => ALLOWED_EVENTS.has(e)),
  meta: metaSchema,
});

/**
 * POST /api/analytics/event
 * Lightweight platform-level event tracking. No PII beyond optional userId.
 * Fire-and-forget from the client — always returns 200 unless the input is
 * rejected or rate-limited.
 */
export async function POST(req: NextRequest): Promise<NextResponse<unknown>> {
  const limited = checkAnalyticsEventRateLimit(getClientIp(req));
  if (limited) return limited;

  try {
    const raw = await req.text();
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
      return NextResponse.json({ success: false }, { status: 413 });
    }
    const parsed = eventSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      return NextResponse.json({ success: false }, { status: 400 });
    }
    const { event, meta } = parsed.data;

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
