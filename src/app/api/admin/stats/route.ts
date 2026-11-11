import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { prisma } from '@/lib/prisma';
import { handleApiError } from '@/lib/api-error';

/**
 * GET /api/admin/stats – user and project totals for the admin overview (contributor only).
 * Two counts, so the overview needn't download every row or run the full analytics query set.
 */
export async function GET(req: NextRequest): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    const [userCount, projectCount] = await Promise.all([prisma.user.count(), prisma.project.count()]);
    return NextResponse.json({ success: true, data: { userCount, projectCount } });
  } catch (error) {
    return handleApiError(error);
  }
}
