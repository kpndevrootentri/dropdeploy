import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { adminService } from '@/services/admin';
import { forEachItem } from '@/services/admin/admin-tools.service';
import { handleApiError } from '@/lib/api-error';

const bulkQuotaSchema = z
  .object({
    userIds: z.array(z.string().min(1)).min(1).max(500),
    projectQuota: z.number().int().min(0).optional(),
    domainQuota: z.number().int().min(0).optional(),
  })
  .refine((d) => d.projectQuota !== undefined || d.domainQuota !== undefined, 'Nothing to update');

/**
 * POST /api/admin/users/bulk-quota – set the project and/or domain quota of
 * several users; reports each one's outcome (contributor only).
 */
export async function POST(req: NextRequest): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    const { userIds, projectQuota, domainQuota } = bulkQuotaSchema.parse(await req.json());
    const results = await forEachItem(userIds, async (id) => {
      if (projectQuota !== undefined) await adminService.updateUserQuota(id, projectQuota);
      if (domainQuota !== undefined) await adminService.updateUserDomainQuota(id, domainQuota);
    });
    return NextResponse.json({ success: true, data: results });
  } catch (error) {
    return handleApiError(error);
  }
}
