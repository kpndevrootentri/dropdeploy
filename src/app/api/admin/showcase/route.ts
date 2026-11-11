import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { showcaseService } from '@/services/showcase/showcase.service';
import { handleApiError } from '@/lib/api-error';

/**
 * GET /api/admin/showcase – every showcase entry, published or not (contributor only).
 */
export async function GET(req: NextRequest): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    return NextResponse.json({ success: true, data: await showcaseService.adminList() });
  } catch (error) {
    return handleApiError(error);
  }
}
