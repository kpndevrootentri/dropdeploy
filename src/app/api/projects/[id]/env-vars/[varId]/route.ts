import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { projectService } from '@/services/project';
import { envVarService } from '@/services/env-var';
import { handleApiError } from '@/lib/api-error';
import { updateEnvVarSchema } from '@/validators/env-var.validator';
import { ValidationError } from '@/lib/errors';
import { checkEnvVarRateLimit } from '@/lib/rate-limit';

type RouteCtx = { params: Promise<{ id: string; varId: string }> };

/**
 * PUT /api/projects/:id/env-vars/:varId – update env var value.
 */
export async function PUT(
  req: NextRequest,
  { params }: RouteCtx,
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const rateLimitErr = checkEnvVarRateLimit(session.userId);
    if (rateLimitErr) return rateLimitErr;

    const { id, varId } = await params;
    await projectService.getById(id, session.userId);

    const body = await req.json();
    const parsed = updateEnvVarSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid input');
    }

    const envVar = await envVarService.update(varId, id, parsed.data, session.userId);
    return NextResponse.json({ success: true, data: envVar });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * DELETE /api/projects/:id/env-vars/:varId – delete an env var.
 */
export async function DELETE(
  req: NextRequest,
  { params }: RouteCtx,
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const rateLimitErr = checkEnvVarRateLimit(session.userId);
    if (rateLimitErr) return rateLimitErr;

    const { id, varId } = await params;
    await projectService.getById(id, session.userId);

    await envVarService.delete(varId, id, session.userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
