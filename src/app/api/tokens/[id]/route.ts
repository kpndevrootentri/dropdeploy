import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { apiTokenService } from '@/services/api-token';
import { handleApiError } from '@/lib/api-error';

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * DELETE /api/tokens/:id – revoke one of the user's API tokens. It stops working at once.
 */
export async function DELETE(req: NextRequest, { params }: RouteCtx): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const { id } = await params;
    await apiTokenService.revoke(session.userId, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
