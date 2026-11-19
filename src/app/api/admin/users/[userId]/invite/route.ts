import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { adminService } from '@/services/admin';
import { handleApiError } from '@/lib/api-error';
import { invitePath, inviteService } from '@/services/invite';

const bodySchema = z.object({ kind: z.enum(['invite', 'reset']) });

/**
 * POST /api/admin/users/[userId]/invite – issue a new one-time password link and
 * email it (contributor only). Body `{ kind }`: 'invite' (7 days, only for users
 * who have not chosen a password) or 'reset' (1 hour). Earlier unused links stop
 * working; the new one is also returned once, for when the email does not arrive.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    const { userId } = await params;
    const { kind } = bodySchema.parse(await req.json());
    const { token, email } = await adminService.issuePasswordLink(userId, kind, session.userId);
    const emailed = await inviteService.sendLink(email, token, kind);
    return NextResponse.json(
      { success: true, data: { invitePath: invitePath(token), emailed } },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
