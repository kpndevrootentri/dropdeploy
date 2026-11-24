import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { emailService } from '@/services/email';
import { handleApiError } from '@/lib/api-error';

/**
 * POST /api/admin/email/test – send a test email to the signed-in admin through SES,
 * whatever the quotas (contributor only). Returns SES's error when it refuses.
 */
export async function POST(req: NextRequest): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    return NextResponse.json({ success: true, data: await emailService.sendTest(session.email) });
  } catch (error) {
    return handleApiError(error);
  }
}
