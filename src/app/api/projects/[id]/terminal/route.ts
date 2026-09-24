import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/get-session';
import { projectService } from '@/services/project';
import { handleApiError } from '@/lib/api-error';
import { dockerOps, containerNameFor } from '@/lib/docker-ops';
import { ValidationError, AppError } from '@/lib/errors';
import { checkTerminalRateLimit } from '@/lib/rate-limit';
import { createLogger } from '@/lib/logger';

const log = createLogger('terminal');

const terminalCommandSchema = z.object({
    command: z.string().min(1, 'Command is required').max(1000, 'Command too long'),
});

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * POST /api/projects/:id/terminal – execute command inside project container.
 */
export async function POST(
    req: NextRequest,
    { params }: RouteCtx,
): Promise<NextResponse<unknown>> {
    try {
        const session = await getSession(req);
        const limited = checkTerminalRateLimit(session.userId);
        if (limited) return limited;
        const { id: projectId } = await params;

        const body = await req.json();
        const parsed = terminalCommandSchema.safeParse(body);
        if (!parsed.success) {
            throw new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid input');
        }

        const project = await projectService.getByIdWithDeployments(projectId, session.userId);

        const latestDeployment = (project as { deployments: Array<{ status: string }> }).deployments?.[0];
        if (!latestDeployment || latestDeployment.status !== 'DEPLOYED') {
            throw new AppError('NOT_DEPLOYED', 'Project is not currently deployed', 400);
        }

        const containerName = containerNameFor((project as { slug: string }).slug);

        // Runs in the worker, which holds the Docker socket; this process doesn't.
        const result = await dockerOps.terminal(containerName, parsed.data.command);

        return NextResponse.json({ success: true, data: result });
    } catch (error) {
        // User-facing terminal errors are TerminalErrors (an AppError) and pass
        // through with their message; anything else — Docker API failures,
        // socket errors — is logged and answered generically, so internal
        // detail never reaches the browser.
        if (error instanceof Error && !(error instanceof AppError)) {
            log.error('Terminal command failed', { error: error.message });
            return NextResponse.json(
                {
                    success: false,
                    error: { code: 'TERMINAL_ERROR', message: 'The command could not be run. Try again, or redeploy the project.' },
                },
                { status: 500 },
            );
        }
        return handleApiError(error);
    }
}
