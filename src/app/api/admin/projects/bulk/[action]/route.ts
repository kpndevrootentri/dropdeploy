import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { adminService } from '@/services/admin';
import { forEachItem } from '@/services/admin/admin-tools.service';
import { handleApiError } from '@/lib/api-error';
import { NotFoundError, ValidationError } from '@/lib/errors';

/** Typed by the admin in the UI; required here too, so a stray request cannot bulk-delete. */
const BULK_DELETE_CONFIRMATION = 'DELETE';

const bulkSchema = z.object({
  // Each delete waits for the worker to remove a container, so keep a run bounded.
  projectIds: z.array(z.string().min(1)).min(1).max(50),
  confirm: z.string().optional(),
});

/**
 * POST /api/admin/projects/bulk/[action] – stop, redeploy or delete several
 * projects; reports each one's outcome (contributor only).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ action: string }> },
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    const { action } = await params;
    const { projectIds, confirm } = bulkSchema.parse(await req.json());

    let run: (id: string) => Promise<unknown>;
    if (action === 'stop') run = (id) => adminService.stopContainer(id);
    else if (action === 'redeploy') run = (id) => adminService.forceRedeploy(id, session.userId);
    else if (action === 'delete') {
      if (confirm !== BULK_DELETE_CONFIRMATION) {
        throw new ValidationError(`Type ${BULK_DELETE_CONFIRMATION} to confirm a bulk delete`);
      }
      run = (id) => adminService.deleteProject(id);
    } else throw new NotFoundError('Bulk action');

    return NextResponse.json({ success: true, data: await forEachItem(projectIds, run) });
  } catch (error) {
    return handleApiError(error);
  }
}
