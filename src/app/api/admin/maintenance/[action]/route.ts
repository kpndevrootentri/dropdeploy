import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { adminToolsService } from '@/services/admin/admin-tools.service';
import { handleApiError } from '@/lib/api-error';
import { NotFoundError } from '@/lib/errors';

type Ctx = { params: Promise<{ action: string }> };

const slugsSchema = z.object({ slugs: z.array(z.string().max(63)).min(1).max(500) });
const retentionSchema = z.object({ retentionDays: z.number().int() });

/**
 * GET /api/admin/maintenance/[action] – dry run: what the action would remove (contributor only).
 * Actions: `orphans` (containers of deleted projects), `images` (untagged
 * project images), `proxy-hits` (traffic rows past the retention period).
 */
export async function GET(req: NextRequest, { params }: Ctx): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    const { action } = await params;
    const preview =
      action === 'orphans' ? adminToolsService.previewOrphanContainers()
      : action === 'images' ? adminToolsService.previewDanglingImages()
      : action === 'proxy-hits' ? adminToolsService.previewProxyHitCleanup()
      : Promise.reject(new NotFoundError('Maintenance action'));
    return NextResponse.json({ success: true, data: await preview });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/admin/maintenance/[action] – run an action on what its preview
 * returned; the server re-checks before removing anything (contributor only).
 */
export async function POST(req: NextRequest, { params }: Ctx): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    const { action } = await params;
    const body = await req.json();
    const result =
      action === 'orphans' ? adminToolsService.removeOrphanContainers(slugsSchema.parse(body).slugs)
      : action === 'images' ? adminToolsService.removeDanglingImages(slugsSchema.parse(body).slugs)
      : action === 'proxy-hits' ? adminToolsService.deleteOldProxyHits(retentionSchema.parse(body).retentionDays)
      : Promise.reject(new NotFoundError('Maintenance action'));
    return NextResponse.json({ success: true, data: await result });
  } catch (error) {
    return handleApiError(error);
  }
}
