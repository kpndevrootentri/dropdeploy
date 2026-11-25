import { NextRequest, NextResponse, after } from 'next/server';
import { getSession } from '@/lib/get-session';
import { cohortService } from '@/services/cohort';
import { invitePath, inviteService } from '@/services/invite';
import { addStudentsSchema } from '@/validators/cohort.validator';
import { isEmailConfigured } from '@/lib/email';
import { checkRateLimit, holdRateLimit } from '@/lib/rate-limit';
import { handleApiError } from '@/lib/api-error';

const HOUR_MS = 60 * 60_000;
/** Far below the platform's daily email quota, which invites share with password resets. */
const MENTOR_INVITES_PER_DAY = 200;
const MENTOR_BUDGET = {
  windowMs: 24 * HOUR_MS,
  max: MENTOR_INVITES_PER_DAY,
  message: `You can invite up to ${MENTOR_INVITES_PER_DAY} people a day. Try again tomorrow, or ask an admin.`,
};

/**
 * POST /api/cohorts/[cohortId]/students – add students by email (admins, and mentors of the batch).
 * New emails get an invited account, emailed their link after the response when email is on.
 * The service decides who may add whom; everyone else gets a 404.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ cohortId: string }> },
): Promise<NextResponse<unknown>> {
  try {
    const session = await getSession(req);
    const limited = checkRateLimit(`cohort-add-students:${session.userId}`, { windowMs: HOUR_MS, max: 20 });
    if (limited) return limited;
    const { cohortId } = await params;
    const { emails } = addStudentsSchema.parse(await req.json());
    // Mentors may invite (and so create accounts and send emails for) only so many people a day.
    // The whole list is held against the budget while the request runs, so parallel requests can't
    // all pass the check; afterwards only the people actually invited stay charged. A request is
    // refused only once the budget is used up, so one request can go over it by up to 99.
    let refund = (_amount: number): void => {};
    if (session.role !== 'CONTRIBUTOR') {
      const hold = holdRateLimit(`cohort-add-students-day:${session.userId}`, MENTOR_BUDGET, emails.length);
      if (hold.refused) return hold.refused;
      refund = hold.refund;
    }
    const { invited, added, skipped } = await cohortService.addStudents(cohortId, emails, session).catch((error: unknown) => {
      refund(emails.length);
      throw error;
    });
    refund(emails.length - invited.length);
    const emailOn = isEmailConfigured();
    const emailing = emailOn && invited.length > 0;
    if (emailing) after(() => inviteService.sendInvites(invited));
    // Whoever opens an invite link first sets the password, so mentors get links only when email can't deliver them.
    const showLinks = session.role === 'CONTRIBUTOR' || !emailOn;
    return NextResponse.json(
      {
        success: true,
        data: {
          invited: invited.map(({ email, inviteToken }) => ({ email, invitePath: showLinks ? invitePath(inviteToken) : null })),
          added,
          skipped,
          emailing,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
