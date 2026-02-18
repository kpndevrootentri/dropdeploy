import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { projectService } from '@/services/project';
import { envVarService } from '@/services/env-var';
import { handleApiError } from '@/lib/api-error';
import { createEnvVarSchema } from '@/validators/env-var.validator';
import { ValidationError } from '@/lib/errors';
import { checkEnvVarRateLimit } from '@/lib/rate-limit';

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * GET /api/projects/:id/env-vars – list all env vars for a project (values masked).
 */
export async function GET(
  req: NextRequest,
  { params }: RouteCtx,
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const rateLimitErr = checkEnvVarRateLimit(session.userId);
    if (rateLimitErr) return rateLimitErr;

    const { id } = await params;
    await projectService.getById(id, session.userId);
    const envVars = await envVarService.listByProject(id);
    return NextResponse.json({ success: true, data: envVars });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/projects/:id/env-vars – create a new env var.
 */
export async function POST(
  req: NextRequest,
  { params }: RouteCtx,
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const rateLimitErr = checkEnvVarRateLimit(session.userId);
    if (rateLimitErr) return rateLimitErr;

    const { id } = await params;
    await projectService.getById(id, session.userId);

    const body = await req.json();
    const parsed = createEnvVarSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid input');
    }

    const envVar = await envVarService.create(id, parsed.data, session.userId);
    return NextResponse.json({ success: true, data: envVar }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
