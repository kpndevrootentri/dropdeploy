import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { domainService } from '@/services/domain';
import { handleApiError } from '@/lib/api-error';

/**
 * GET /api/admin/domains – every custom domain on the platform (contributor only).
 */
export async function GET(req: NextRequest): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    return NextResponse.json({ success: true, data: await domainService.adminList() });
  } catch (error) {
    return handleApiError(error);
  }
}
