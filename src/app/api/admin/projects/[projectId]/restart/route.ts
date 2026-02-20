import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { adminService } from '@/services/admin';
import { handleApiError } from '@/lib/api-error';

/**
 * POST /api/admin/projects/[projectId]/restart – restart container (contributor only).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    const { projectId } = await params;
    await adminService.restartContainer(projectId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
