import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { adminService } from '@/services/admin';
import { handleApiError } from '@/lib/api-error';

const bulkCreateSchema = z.object({
  emails: z.array(z.string().max(254)).min(1).max(500),
  password: z.string().min(8),
});

/**
 * POST /api/admin/users/bulk – create many users with one temporary password (contributor only).
 * Returns which emails were created, skipped as already registered, or rejected as invalid.
 */
export async function POST(req: NextRequest): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    const { emails, password } = bulkCreateSchema.parse(await req.json());
    const result = await adminService.bulkCreateUsers(emails, password);
    return NextResponse.json({ success: true, data: result }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
