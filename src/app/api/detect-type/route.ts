import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { detectFromRawUrl } from '@/lib/type-detector';
import { gitProviderService } from '@/services/git-provider';
import { handleApiError } from '@/lib/api-error';
import { z } from 'zod';

const schema = z.object({
  repoUrl: z.string().url(),
  branch: z.string().min(1).default('main'),
});

/**
 * POST /api/detect-type
 * Detects the project type from a repo URL by fetching indicator files via
 * raw HTTP (no clone). Uses the user's stored OAuth token for private repos.
 */
export async function POST(req: NextRequest): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const body = await req.json();
    const { repoUrl, branch } = schema.parse(body);

    const source = repoUrl.includes('gitlab.com') ? 'GITLAB' : 'GITHUB';
    let token: string | undefined;
    try {
      token = (await gitProviderService.getTokenForDeployment(session.userId, source)) ?? undefined;
    } catch {
      // No connected provider — try public access
    }

    const result = await detectFromRawUrl(repoUrl, branch, token);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return handleApiError(error);
  }
}
