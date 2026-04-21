import { NextRequest, NextResponse } from 'next/server';
import { showcaseService } from '@/services/showcase/showcase.service';
import { handleApiError } from '@/lib/api-error';

type RouteCtx = { params: Promise<{ slug: string }> };

export async function GET(_req: NextRequest, { params }: RouteCtx): Promise<NextResponse<unknown>> {
  try {
    const { slug } = await params;
    const showcase = await showcaseService.getPublicBySlug(slug);
    return NextResponse.json({ success: true, data: showcase });
  } catch (error) {
    return handleApiError(error);
  }
}
