import { NextRequest, NextResponse } from 'next/server';
import { showcaseService } from '@/services/showcase/showcase.service';
import { cohortService } from '@/services/cohort';
import { getSession } from '@/lib/get-session';
import { handleApiError } from '@/lib/api-error';

const PAGE_SIZE = 12;

export async function GET(req: NextRequest): Promise<NextResponse<unknown>> {
  try {
    const { searchParams } = req.nextUrl;
    const skip = Math.max(0, parseInt(searchParams.get('skip') ?? '0', 10) || 0);
    const take = Math.min(PAGE_SIZE, Math.max(1, parseInt(searchParams.get('take') ?? String(PAGE_SIZE), 10) || PAGE_SIZE));
    const tag = searchParams.get('tag') ?? undefined;
    const q = searchParams.get('q') ?? undefined;
    const cohort = searchParams.get('cohortId');
    // Only admins and mentors may filter by batch. A batch the viewer may not use (or no longer may, after a
    // logout mid-scroll) gets an empty page, the same whether or not it exists, never the unfiltered list.
    const cohortId = cohort
      ? (await cohortService.exploreFilter(await getSession(req).catch(() => null), cohort)).cohortId
      : undefined;

    const { items, total } = cohort && !cohortId
      ? { items: [], total: 0 }
      : await showcaseService.getPublished({ skip, take, tag, q, cohortId });

    return NextResponse.json(
      { success: true, data: { items, total, hasMore: skip + items.length < total } },
      // With a batch filter the answer depends on who asked, so no shared cache may keep it.
      cohort ? { headers: { 'Cache-Control': 'private, no-store' } } : undefined,
    );
  } catch (error) {
    return handleApiError(error);
  }
}
