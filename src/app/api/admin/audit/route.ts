import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { adminService } from '@/services/admin';
import { handleApiError } from '@/lib/api-error';

const PAGE_SIZE = 50;

/**
 * GET /api/admin/audit?before=<id> – admin actions, newest first, 50 per page (contributor only).
 * `before` is the id of the last entry already shown.
 */
export async function GET(req: NextRequest): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    const before = req.nextUrl.searchParams.get('before') ?? undefined;
    const actions = await adminService.listActions(PAGE_SIZE, before);
    return NextResponse.json({ success: true, data: { actions, hasMore: actions.length === PAGE_SIZE } });
  } catch (error) {
    return handleApiError(error);
  }
}
