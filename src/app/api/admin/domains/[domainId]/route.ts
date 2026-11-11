import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { domainService } from '@/services/domain';
import { handleApiError } from '@/lib/api-error';

/**
 * DELETE /api/admin/domains/[domainId] – release any project's domain (contributor only).
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ domainId: string }> },
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    const { domainId } = await params;
    await domainService.adminRemove(domainId, session.userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
