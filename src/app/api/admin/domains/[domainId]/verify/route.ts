import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { domainService } from '@/services/domain';
import { handleApiError } from '@/lib/api-error';
import { checkDomainVerifyRateLimit } from '@/lib/rate-limit';

/**
 * POST /api/admin/domains/[domainId]/verify – run a DNS check on any domain now (contributor only).
 * Shares the owner route's rate limit: each check makes outbound DNS queries.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ domainId: string }> },
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    const limited = checkDomainVerifyRateLimit(session.userId);
    if (limited) return limited;
    const { domainId } = await params;
    return NextResponse.json({ success: true, data: await domainService.adminVerify(domainId) });
  } catch (error) {
    return handleApiError(error);
  }
}
