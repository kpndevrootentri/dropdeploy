import { NextRequest, NextResponse, after } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/get-session';
import { requireContributor } from '@/lib/require-contributor';
import { adminService } from '@/services/admin';
import { handleApiError } from '@/lib/api-error';
import { isEmailConfigured } from '@/lib/email';
import { invitePath, inviteService } from '@/services/invite';

/**
 * Larger imports are not emailed: a personal Gmail account sends at most 500 a
 * day, and one big import would use it all up, leaving forgot-password emails
 * undelivered until the next day. The admin sends those links themselves.
 */
const BULK_EMAIL_MAX = 100;

const bulkInviteSchema = z.object({
  emails: z.array(z.string().max(254)).min(1).max(500),
});

/**
 * POST /api/admin/users/bulk – invite many users, each with their own one-time link (contributor only).
 * Returns the created emails with their invite link paths, plus those skipped as already registered or invalid.
 * Up to BULK_EMAIL_MAX new users are also emailed their link, after the response, one at a time.
 */
export async function POST(req: NextRequest): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    requireContributor(session);
    const { emails } = bulkInviteSchema.parse(await req.json());
    const { created, skipped, invalid } = await adminService.bulkInviteUsers(emails, session.userId);
    const emailing = isEmailConfigured() && created.length > 0 && created.length <= BULK_EMAIL_MAX;
    if (emailing) {
      // After the response: a hundred SMTP sends would outlast the request.
      // ponytail: not queued; links not yet sent when the process restarts are never emailed (the admin still has them).
      after(async () => {
        for (const { email, inviteToken } of created) await inviteService.sendLink(email, inviteToken, 'invite');
      });
    }
    return NextResponse.json(
      {
        success: true,
        data: {
          created: created.map(({ email, inviteToken }) => ({ email, invitePath: invitePath(inviteToken) })),
          skipped,
          invalid,
          emailing,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
