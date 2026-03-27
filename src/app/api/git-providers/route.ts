import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { gitProviderService } from '@/services/git-provider';
import { handleApiError } from '@/lib/api-error';

/**
 * GET /api/git-providers — list connected git providers for current user.
 */
export async function GET(req: NextRequest): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const providers = await gitProviderService.listByUser(session.userId);
    return NextResponse.json({ success: true, data: providers });
  } catch (error) {
    return handleApiError(error);
  }
}
