import { NextRequest, NextResponse } from 'next/server';
import { showcaseService } from '@/services/showcase/showcase.service';
import { handleApiError } from '@/lib/api-error';

const PAGE_SIZE = 12;

export async function GET(req: NextRequest): Promise<NextResponse<unknown>> {
  try {
    const { searchParams } = req.nextUrl;
    const skip = Math.max(0, parseInt(searchParams.get('skip') ?? '0', 10) || 0);
    const take = Math.min(PAGE_SIZE, Math.max(1, parseInt(searchParams.get('take') ?? String(PAGE_SIZE), 10) || PAGE_SIZE));
    const tag = searchParams.get('tag') ?? undefined;
    const q = searchParams.get('q') ?? undefined;

    const { items, total } = await showcaseService.getPublished({ skip, take, tag, q });

    return NextResponse.json({
      success: true,
      data: { items, total, hasMore: skip + items.length < total },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
