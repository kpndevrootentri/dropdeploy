import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { notificationService } from '@/services/notification';
import { handleApiError } from '@/lib/api-error';

type RouteCtx = { params: Promise<{ id: string; hookId: string }> };

/**
 * DELETE /api/projects/:id/notifications/:hookId – remove a hook (owner only).
 */
export async function DELETE(req: NextRequest, { params }: RouteCtx): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const { id, hookId } = await params;
    await notificationService.remove(id, session.userId, hookId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
