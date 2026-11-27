import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { notificationService } from '@/services/notification';
import { createNotificationHookSchema } from '@/validators/notification.validator';
import { checkNotificationHookRateLimit } from '@/lib/rate-limit';
import { handleApiError } from '@/lib/api-error';
import { ValidationError } from '@/lib/errors';

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * GET /api/projects/:id/notifications – the project's notification hooks, without URLs or secrets (owner only).
 */
export async function GET(req: NextRequest, { params }: RouteCtx): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const { id } = await params;
    const hooks = await notificationService.list(id, session.userId);
    return NextResponse.json({ success: true, data: hooks });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/projects/:id/notifications – add a hook (owner only). The response carries its signing secret, once.
 */
export async function POST(req: NextRequest, { params }: RouteCtx): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const limited = checkNotificationHookRateLimit(session.userId);
    if (limited) return limited;
    const { id } = await params;

    const parsed = createNotificationHookSchema.safeParse(await req.json());
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid input');
    }

    const hook = await notificationService.create(id, session.userId, parsed.data);
    return NextResponse.json({ success: true, data: hook }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
