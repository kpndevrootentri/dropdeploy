jest.mock('@/lib/email', () => ({ isEmailConfigured: jest.fn(() => true) }));
const mockSession = { userId: 'm1', email: 'mentor@entri.me', role: 'USER', mustResetPassword: false };
jest.mock('@/lib/get-session', () => ({ getSession: async () => mockSession }));
// By default everyone in the list is new and invited.
const mockAddStudents = jest.fn(async (_cohortId: string, emails: string[], _viewer: unknown) =>
  ({ invited: emails.map((email) => ({ email, inviteToken: 'tok' })), added: [] as string[], skipped: [] as { email: string; reason: string }[] }));
jest.mock('@/services/cohort', () => ({ cohortService: { addStudents: mockAddStudents } }));
const mockSendInvites = jest.fn(async () => {});
jest.mock('@/services/invite', () => ({ invitePath: (token: string) => `/invite/${token}`, inviteService: { sendInvites: mockSendInvites } }));
// Outside a real request, run the deferred work at once.
jest.mock('next/server', () => ({ ...jest.requireActual('next/server'), after: (task: () => unknown) => task() }));

import { NextRequest } from 'next/server';
import { isEmailConfigured } from '@/lib/email';
import { checkRateLimit, holdRateLimit } from '@/lib/rate-limit';
import { POST } from '@/app/api/cohorts/[cohortId]/students/route';

function post(role: string, userId: string, emails = ['new@entri.me']): Promise<Response> {
  Object.assign(mockSession, { role, userId });
  return POST(
    new NextRequest('http://localhost/api/cohorts/c1/students', { method: 'POST', body: JSON.stringify({ emails }) }),
    { params: Promise.resolve({ cohortId: 'c1' }) },
  );
}

async function add(role: string, userId: string): Promise<{ invited: { email: string; invitePath: string | null }[]; emailing: boolean }> {
  const res = await post(role, userId);
  expect(res.status).toBe(201);
  return (await res.json()).data;
}

const emails = (n: number, tag: string): string[] => Array.from({ length: n }, (_, i) => `${tag}${i}@entri.me`);

describe('POST /api/cohorts/[cohortId]/students', () => {
  beforeEach(() => mockSendInvites.mockClear());

  it("emails a mentor's invites and never shows them the link while email is on", async () => {
    jest.mocked(isEmailConfigured).mockReturnValue(true);
    expect(await add('USER', 'm1')).toEqual({ invited: [{ email: 'new@entri.me', invitePath: null }], added: [], skipped: [], emailing: true });
    expect(mockSendInvites).toHaveBeenCalledWith([{ email: 'new@entri.me', inviteToken: 'tok' }]);
  });

  it('shows a mentor the link while email is off, since nothing else can deliver it', async () => {
    jest.mocked(isEmailConfigured).mockReturnValue(false);
    expect((await add('USER', 'm2')).invited).toEqual([{ email: 'new@entri.me', invitePath: '/invite/tok' }]);
    expect(mockSendInvites).not.toHaveBeenCalled();
  });

  it.each([true, false])('always shows an admin the link (email on: %s)', async (on) => {
    jest.mocked(isEmailConfigured).mockReturnValue(on);
    const result = await add('CONTRIBUTOR', `admin-${on}`);
    expect(result.invited).toEqual([{ email: 'new@entri.me', invitePath: '/invite/tok' }]);
    expect(result.emailing).toBe(on);
  });
});

describe("a mentor's daily invite budget", () => {
  const BUDGET_MESSAGE = 'You can invite up to 200 people a day. Try again tomorrow, or ask an admin.';

  it('refuses a mentor once 200 people were invited that day, with its own message', async () => {
    expect((await post('USER', 'budget-mentor', emails(100, 'a'))).status).toBe(201);
    expect((await post('USER', 'budget-mentor', emails(100, 'b'))).status).toBe(201);
    const res = await post('USER', 'budget-mentor', emails(1, 'c'));
    expect(res.status).toBe(429);
    expect((await res.json()).error.message).toBe(BUDGET_MESSAGE);
  });

  it('charges a mentor only for the people actually invited, not existing or invalid entries', async () => {
    for (let i = 0; i < 3; i++) {
      mockAddStudents.mockImplementationOnce(async (_c, list) => ({ invited: [], added: [], skipped: list.map((email) => ({ email, reason: 'x' })) }));
      expect((await post('USER', 'roster-mentor', emails(100, `r${i}`))).status).toBe(201);
    }
    expect((await post('USER', 'roster-mentor', emails(100, 'n1'))).status).toBe(201);
    expect((await post('USER', 'roster-mentor', emails(100, 'n2'))).status).toBe(201);
  });

  it('holds the list while a request runs, so parallel requests cannot all pass the check', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const slowInvite = async (_c: string, list: string[]) => {
      await gate;
      return { invited: list.map((email) => ({ email, inviteToken: 'tok' })), added: [], skipped: [] };
    };
    mockAddStudents.mockImplementationOnce(slowInvite).mockImplementationOnce(slowInvite);
    const pending = [0, 1, 2].map((i) => post('USER', 'parallel-mentor', emails(100, `p${i}`)));
    await new Promise((resolve) => setImmediate(resolve));
    release();
    expect((await Promise.all(pending)).map((r) => r.status)).toEqual([201, 201, 429]);
  });

  it('gives back what a failed request held', async () => {
    mockAddStudents.mockRejectedValueOnce(new Error('boom')).mockRejectedValueOnce(new Error('boom'));
    for (let i = 0; i < 2; i++) expect((await post('USER', 'failing-mentor', emails(100, `f${i}`))).status).toBe(500);
    expect((await post('USER', 'failing-mentor', emails(100, 'ok'))).status).toBe(201);
    expect((await post('USER', 'failing-mentor', emails(100, 'ok2'))).status).toBe(201);
  });

  it('never charges an admin', async () => {
    for (let i = 0; i < 3; i++) expect((await post('CONTRIBUTOR', 'budget-admin', emails(100, `a${i}`))).status).toBe(201);
    expect((await post('CONTRIBUTOR', 'budget-admin', emails(1, 'last'))).status).toBe(201);
  });
});

describe('checkRateLimit cost', () => {
  const opts = { windowMs: 60_000, max: 5 };

  afterEach(() => jest.useRealTimers());

  it('adds cost per allowed request and refuses once the limit is reached, adding nothing', () => {
    expect(checkRateLimit('cost-test', opts, 3)).toBeNull();
    // Not yet at the limit, so this one is allowed and goes past it.
    const hold = holdRateLimit('cost-test', opts, 3);
    expect(checkRateLimit('cost-test', opts)?.status).toBe(429);
    if (hold.refused) throw new Error('the hold was refused');
    hold.refund(2);
    expect(checkRateLimit('cost-test', opts)).toBeNull();
  });

  it("never gives a hold's refund to a later window", () => {
    jest.useFakeTimers({ now: new Date('2027-01-01T00:00:00Z') });
    const day = { windowMs: 24 * 60 * 60_000, max: 200 };
    const old = holdRateLimit('window-test', day, 100);
    jest.setSystemTime(new Date('2027-01-02T00:00:01Z'));
    const fresh = holdRateLimit('window-test', day, 100);
    if (old.refused || fresh.refused) throw new Error('a hold was refused');
    old.refund(100);
    // The new window still counts 100: one more hold of 100 fills it, and then it refuses.
    expect(holdRateLimit('window-test', day, 100).refused).toBeNull();
    expect(holdRateLimit('window-test', day, 1).refused?.status).toBe(429);
  });

  it('counts requests by default', () => {
    for (let i = 0; i < 5; i++) expect(checkRateLimit('count-test', opts)).toBeNull();
    expect(checkRateLimit('count-test', opts)?.status).toBe(429);
  });
});
