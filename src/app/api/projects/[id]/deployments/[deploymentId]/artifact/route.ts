import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import { getSession } from '@/lib/get-session';
import { deploymentService } from '@/services/deployment';
import { handleApiError } from '@/lib/api-error';
import { NotFoundError } from '@/lib/errors';

/**
 * GET /api/projects/:id/deployments/:deploymentId/artifact
 * Streams the APK artifact for an Android deployment.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; deploymentId: string }> },
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const { deploymentId } = await params;

    const deployment = await deploymentService.getById(deploymentId, session.userId);

    if (!deployment.artifactUrl) {
      throw new NotFoundError('Artifact');
    }

    const stat = await fs.promises.stat(deployment.artifactUrl).catch(() => null);
    if (!stat) {
      throw new NotFoundError('Artifact');
    }

    const fileStream = fs.createReadStream(deployment.artifactUrl);

    return new NextResponse(fileStream as unknown as ReadableStream, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.android.package-archive',
        'Content-Disposition': 'attachment; filename="app.apk"',
        'Content-Length': String(stat.size),
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
