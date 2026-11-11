import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ProjectType, SourceType } from '@prisma/client';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { adminService } from '@/services/admin';
import { handleApiError } from '@/lib/api-error';

/** What the admin must type before anything is queued (matches the dialog). Not exported: route files may only export handlers. */
const REDEPLOY_ALL_CONFIRMATION = 'redeploy all';

const redeployAllSchema = z
  .object({
    type: z.nativeEnum(ProjectType).optional(),
    source: z.nativeEnum(SourceType).optional(),
    dryRun: z.boolean(),
    confirm: z.string().optional(),
    /** The eligible ids from the preview; required to queue, so nothing the admin did not see is rebuilt. */
    projectIds: z.array(z.string().max(64)).max(10_000).optional(),
  })
  .refine((b) => b.dryRun || b.confirm === REDEPLOY_ALL_CONFIRMATION, {
    message: `Type "${REDEPLOY_ALL_CONFIRMATION}" to confirm`,
    path: ['confirm'],
  })
  .refine((b) => b.dryRun || b.projectIds !== undefined, {
    message: 'Preview first, then confirm the projects it listed',
    path: ['projectIds'],
  });

/**
 * POST /api/admin/projects/redeploy-all – rebuild every matching repository project (contributor only).
 * `dryRun: true` only lists what would be queued and what is skipped, and why.
 * The confirmed run sends back the previewed ids and queues only those that are still eligible.
 */
export async function POST(req: NextRequest): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    const { type, source, dryRun, projectIds } = redeployAllSchema.parse(await req.json());
    const result = await adminService.redeployAll({ type, source, projectIds }, dryRun);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return handleApiError(error);
  }
}
