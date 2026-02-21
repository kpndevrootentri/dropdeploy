import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { projectService } from '@/services/project';
import { handleApiError } from '@/lib/api-error';
import { updateProjectSchema } from '@/validators/project.validator';
import { ValidationError } from '@/lib/errors';
import { auditLogRepository } from '@/repositories/audit-log.repository';

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * GET /api/projects/:id – get a single project with its deployments.
 */
export async function GET(
  req: NextRequest,
  { params }: RouteCtx
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const { id } = await params;
    const project = await projectService.getByIdWithDeployments(id, session.userId);
    return NextResponse.json({ success: true, data: project });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * PATCH /api/projects/:id – update project name, description, or type.
 */
export async function PATCH(
  req: NextRequest,
  { params }: RouteCtx
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const { id } = await params;
    const body = await req.json();
    const parsed = updateProjectSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid input');
    }
    const project = await projectService.update(id, session.userId, parsed.data);

    // Non-blocking audit log
    auditLogRepository.create({
      action: 'PROJECT_SETTINGS_UPDATED',
      targetKey: Object.keys(parsed.data).join(','),
      userId: session.userId,
      projectId: id,
    }).catch(() => {});

    return NextResponse.json({ success: true, data: project });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * DELETE /api/projects/:id – delete a project.
 */
export async function DELETE(
  req: NextRequest,
  { params }: RouteCtx
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const { id } = await params;

    // Write audit log before deletion (cascade would remove it after)
    await auditLogRepository.create({
      action: 'PROJECT_DELETED',
      targetKey: id,
      userId: session.userId,
      projectId: id,
    }).catch(() => {});

    await projectService.delete(id, session.userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
