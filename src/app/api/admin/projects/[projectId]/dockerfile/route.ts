import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { adminService } from '@/services/admin';
import { handleApiError } from '@/lib/api-error';

const dockerfileSchema = z.object({ allowed: z.boolean() });

/**
 * PATCH /api/admin/projects/[projectId]/dockerfile – let the project build from
 * its repository's own Dockerfile, or stop it (contributor only).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    const { projectId } = await params;
    const { allowed } = dockerfileSchema.parse(await req.json());
    await adminService.setRepoDockerfileAllowed(projectId, allowed, session.userId);
    return NextResponse.json({ success: true, data: { allowRepoDockerfile: allowed } });
  } catch (error) {
    return handleApiError(error);
  }
}
