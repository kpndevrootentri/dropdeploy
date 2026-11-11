import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { adminService } from '@/services/admin';
import { handleApiError } from '@/lib/api-error';
import { csvResponse } from '@/lib/csv';
import { getDeployedProjectUrl } from '@/lib/project-url';

/**
 * GET /api/admin/projects/export – every project as CSV (contributor only).
 * Columns are picked one by one, so secrets on the project row never reach the file.
 */
export async function GET(req: NextRequest): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    const projects = await adminService.listAllProjects();
    return csvResponse(
      'projects',
      ['name', 'slug', 'owner', 'type', 'source', 'last_deploy_status', 'last_deploy_at', 'url', 'created_at'],
      projects.map((p) => {
        const last = p.deployments[0];
        const url = last?.status === 'DEPLOYED' ? getDeployedProjectUrl(p.slug) : '';
        return [
          p.name,
          p.slug,
          p.user.email,
          p.type,
          p.source,
          last?.status ?? '',
          last?.createdAt ?? '',
          url && !url.startsWith('http') ? `https://${url}` : url,
          p.createdAt,
        ];
      }),
    );
  } catch (error) {
    return handleApiError(error);
  }
}
