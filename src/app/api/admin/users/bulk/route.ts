import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { adminService } from '@/services/admin';
import { handleApiError } from '@/lib/api-error';
import { invitePath } from '@/services/invite';

const bulkInviteSchema = z.object({
  emails: z.array(z.string().max(254)).min(1).max(500),
});

/**
 * POST /api/admin/users/bulk – invite many users, each with their own one-time link (contributor only).
 * Returns the created emails with their invite link paths, plus those skipped as already registered or invalid.
 */
export async function POST(req: NextRequest): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    const { emails } = bulkInviteSchema.parse(await req.json());
    const { created, skipped, invalid } = await adminService.bulkInviteUsers(emails, session.userId);
    return NextResponse.json(
      {
        success: true,
        data: {
          created: created.map(({ email, inviteToken }) => ({ email, invitePath: invitePath(inviteToken) })),
          skipped,
          invalid,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
