import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { projectService } from '@/services/project';
import { envVarService } from '@/services/env-var';
import { handleApiError } from '@/lib/api-error';
import { bulkEnvVarSchema, checkEnvFile, MAX_BULK_ENV_VARS } from '@/validators/env-var.validator';
import { ValidationError } from '@/lib/errors';
import { checkEnvVarImportRateLimit, checkEnvVarRateLimit } from '@/lib/rate-limit';

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * POST /api/projects/:id/env-vars/bulk – set every variable in a .env file at once.
 * Body: { content: string, environment? }. All or nothing: one bad line rejects the whole file,
 * and keys that already exist in that environment are overwritten.
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

    const parsed = bulkEnvVarSchema.safeParse(await req.json());
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid input');
    }

    const { variables, invalid, tooMany } = checkEnvFile(parsed.data.content);
    const bad = invalid[0];
    if (bad) {
      throw new ValidationError(`Line ${bad.line}${bad.key ? ` (${bad.key})` : ''}: ${bad.reason}`);
    }
    if (tooMany) throw new ValidationError(`At most ${MAX_BULK_ENV_VARS} variables at a time`);
    if (variables.length === 0) throw new ValidationError('No variables found');

    // Charged per variable: one import writes up to 200 rows, a single create writes one.
    const importLimitErr = checkEnvVarImportRateLimit(session.userId, variables.length);
    if (importLimitErr) return importLimitErr;

    const result = await envVarService.bulkSet(id, variables, parsed.data.environment ?? 'ALL', session.userId);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return handleApiError(error);
  }
}
