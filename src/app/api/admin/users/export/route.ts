import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { adminService } from '@/services/admin';
import { handleApiError } from '@/lib/api-error';
import { csvResponse } from '@/lib/csv';

/**
 * GET /api/admin/users/export – every user as CSV (contributor only).
 * listAllUsers never selects password hashes or token versions.
 */
export async function GET(req: NextRequest): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    const users = await adminService.listAllUsers();
    return csvResponse(
      'users',
      ['email', 'role', 'project_quota', 'projects', 'domain_quota', 'custom_domains', 'must_reset_password', 'created_at'],
      users.map((u) => [
        u.email,
        u.role,
        u.projectQuota,
        u._count.projects,
        u.domainQuota,
        u._count.customDomains,
        u.mustResetPassword,
        u.createdAt,
      ]),
    );
  } catch (error) {
    return handleApiError(error);
  }
}
