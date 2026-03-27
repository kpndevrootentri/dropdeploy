import { NextRequest, NextResponse } from 'next/server';
import type { SourceType } from '@prisma/client';
import { getSession } from '@/lib/get-session';
import { gitProviderService } from '@/services/git-provider';
import { getRedisConnection } from '@/lib/redis';
import { handleApiError } from '@/lib/api-error';
import { ValidationError } from '@/lib/errors';

type RouteCtx = { params: Promise<{ provider: string }> };

const CACHE_TTL_SECONDS = 300; // 5 minutes

function parseProvider(raw: string): SourceType {
  const upper = raw.toUpperCase();
  if (upper === 'GITHUB' || upper === 'GITLAB') return upper as SourceType;
  throw new ValidationError(`Unknown provider: ${raw}`);
}

/**
 * GET /api/git-providers/:provider/repos?q=&page=&refresh=1
 * Lists/searches repos from the connected provider. Redis-cached for 5 minutes.
 */
export async function GET(
  req: NextRequest,
  { params }: RouteCtx,
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const { provider: rawProvider } = await params;
    const provider = parseProvider(rawProvider);

    const { searchParams } = new URL(req.url);
    const query = searchParams.get('q') ?? '';
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
    const forceRefresh = searchParams.get('refresh') === '1';

    const cacheKey = `repos:${session.userId}:${provider}:${page}:${query}`;
    const redis = getRedisConnection();

    if (!forceRefresh) {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return NextResponse.json({ success: true, data: JSON.parse(cached), cached: true });
      }
    }

    const repos = await gitProviderService.listRepos(session.userId, provider, query, page);
    await redis.set(cacheKey, JSON.stringify(repos), 'EX', CACHE_TTL_SECONDS);

    return NextResponse.json({ success: true, data: repos });
  } catch (error) {
    return handleApiError(error);
  }
}
