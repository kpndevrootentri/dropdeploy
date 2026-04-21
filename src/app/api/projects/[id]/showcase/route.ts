import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/get-session';
import { showcaseService } from '@/services/showcase/showcase.service';
import { handleApiError } from '@/lib/api-error';
import { ValidationError } from '@/lib/errors';

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteCtx): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const { id } = await params;
    const showcase = await showcaseService.getByProjectId(id, session.userId);
    return NextResponse.json({ success: true, data: showcase });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(req: NextRequest, { params }: RouteCtx): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const { id } = await params;
    const body = await req.json() as {
      shortDescription?: unknown;
      tags?: unknown;
      liveUrl?: unknown;
      repoUrl?: unknown;
      contactUrl?: unknown;
      isPublished?: unknown;
    };

    if (typeof body.shortDescription !== 'string') {
      throw new ValidationError('shortDescription must be a string');
    }
    if (!Array.isArray(body.tags)) {
      throw new ValidationError('tags must be an array');
    }
    if (typeof body.isPublished !== 'boolean') {
      throw new ValidationError('isPublished must be a boolean');
    }

    const showcase = await showcaseService.upsert(id, session.userId, {
      shortDescription: body.shortDescription,
      tags: body.tags as string[],
      liveUrl: typeof body.liveUrl === 'string' ? body.liveUrl || null : null,
      repoUrl: typeof body.repoUrl === 'string' ? body.repoUrl || null : null,
      contactUrl: typeof body.contactUrl === 'string' ? body.contactUrl || null : null,
      isPublished: body.isPublished,
    });

    return NextResponse.json({ success: true, data: showcase });
  } catch (error) {
    return handleApiError(error);
  }
}
