import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { adminService } from '@/services/admin';
import { handleApiError } from '@/lib/api-error';

/**
 * GET /api/admin/projects – list all projects (contributor only).
 */
export async function GET(req: NextRequest): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    const projects = await adminService.listAllProjects();
    return NextResponse.json({ success: true, data: projects });
  } catch (error) {
    return handleApiError(error);
  }
}
