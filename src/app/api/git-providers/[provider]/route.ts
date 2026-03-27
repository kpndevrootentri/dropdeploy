import { NextRequest, NextResponse } from 'next/server';
import type { SourceType } from '@prisma/client';
import { getSession } from '@/lib/get-session';
import { gitProviderService } from '@/services/git-provider';
import { handleApiError } from '@/lib/api-error';
import { ValidationError } from '@/lib/errors';

type RouteCtx = { params: Promise<{ provider: string }> };

function parseProvider(raw: string): SourceType {
  const upper = raw.toUpperCase();
  if (upper === 'GITHUB' || upper === 'GITLAB') return upper as SourceType;
  throw new ValidationError(`Unknown provider: ${raw}`);
}

/**
 * DELETE /api/git-providers/:provider — disconnect a git provider.
 */
export async function DELETE(
  req: NextRequest,
  { params }: RouteCtx,
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const { provider: rawProvider } = await params;
    const provider = parseProvider(rawProvider);
    await gitProviderService.disconnect(session.userId, provider);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
