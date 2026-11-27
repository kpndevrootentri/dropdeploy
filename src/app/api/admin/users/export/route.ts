import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { adminService } from '@/services/admin';
import { handleApiError } from '@/lib/api-error';
import { csvResponse } from '@/lib/csv';

/**
 * GET /api/admin/users/export – every user as CSV (contributor only).
 * listAllUsers never selects password hashes or token versions.
 * New columns go at the end, so spreadsheets built on the old order keep working.
 * `?cohortId=` limits it to the batch's current members.
 */
export async function GET(req: NextRequest): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    const users = await adminService.listAllUsers({ cohortId: req.nextUrl.searchParams.get('cohortId') || undefined });
    return csvResponse(
      'users',
      ['email', 'role', 'project_quota', 'projects', 'domain_quota', 'custom_domains', 'must_reset_password', 'created_at', 'batch'],
      users.map((u) => [
        u.email,
        u.role,
        u.projectQuota,
        u._count.projects,
        u.domainQuota,
        u._count.customDomains,
        u.mustResetPassword,
        u.createdAt,
        u.cohortMemberships.map((m) => (m.role === 'MENTOR' ? `${m.cohort.name} (mentor)` : m.cohort.name)).join('; '),
      ]),
    );
  } catch (error) {
    return handleApiError(error);
  }
}
