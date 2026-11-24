import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { emailService } from '@/services/email';
import { handleApiError } from '@/lib/api-error';

/**
 * GET /api/admin/email – SES setup, emails sent against the quotas, and recent
 * failures (contributor only). The quotas themselves are saved through
 * PATCH /api/admin/settings.
 */
export async function GET(req: NextRequest): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    return NextResponse.json(
      { success: true, data: await emailService.usage() },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
