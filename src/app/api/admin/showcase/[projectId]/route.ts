import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { showcaseService } from '@/services/showcase/showcase.service';
import { handleApiError } from '@/lib/api-error';

const flagsSchema = z
  .object({ isPublished: z.boolean().optional(), featured: z.boolean().optional() })
  .refine((d) => d.isPublished !== undefined || d.featured !== undefined, 'Nothing to update');

/**
 * PATCH /api/admin/showcase/[projectId] – unpublish, republish or feature an entry (contributor only).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    const { projectId } = await params;
    const flags = flagsSchema.parse(await req.json());
    return NextResponse.json({ success: true, data: await showcaseService.adminSetFlags(projectId, flags) });
  } catch (error) {
    return handleApiError(error);
  }
}
