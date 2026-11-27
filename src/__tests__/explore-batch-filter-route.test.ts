// GET /api/showcase with ?cohortId=: the real CohortService rules on a fake repository, and the
// showcase query the route sends to the database.
const mockState = {
  session: null as null | { userId: string; role: string; email: string; mustResetPassword: boolean },
  enabled: true,
  memberships: [] as { role: string; cohort: { id: string; name: string } }[],
};
const mockGetSession = jest.fn(async () => {
  if (!mockState.session) throw new Error('Not authenticated');
  return mockState.session;
});
jest.mock('@/lib/get-session', () => ({ getSession: () => mockGetSession() }));
const mockFindMany = jest.fn<Promise<never[]>, [{ where: Record<string, unknown> }]>(async () => []);
jest.mock('@/lib/prisma', () => ({
  prisma: { projectShowcase: { findMany: (args: { where: Record<string, unknown> }) => mockFindMany(args), count: async () => 0 } },
}));
// Pulls in the auth service, which needs the real env; the batch filter never invites anyone.
jest.mock('@/services/invite', () => ({}));
jest.mock('@/services/cohort', () => {
  const { CohortService } = jest.requireActual('@/services/cohort/cohort.service');
  const repo = {
    findAll: async () => [{ id: 'c1', name: 'FSD Jan 2027' }, { id: 'c2', name: 'Data Feb 2027' }],
    listActiveMemberships: async () => mockState.memberships,
  };
  const settings = { get: async () => ({ cohortsEnabled: mockState.enabled }) };
  return { cohortService: new CohortService(repo, {}, {}, {}, {}, settings) };
});

import { NextRequest } from 'next/server';
import { GET } from '@/app/api/showcase/route';

const as = (role: string, memberships: typeof mockState.memberships = []) => {
  mockState.session = { userId: 'u1', role, email: 'u1@entri.me', mustResetPassword: false };
  mockState.memberships = memberships;
};

/**
 * The batch the showcase query was limited to ('all' when unfiltered, 'empty' when the route answered
 * an empty page without querying), and the response's cache header.
 */
async function list(query: string): Promise<{ cohortId: unknown; cache: string | null }> {
  mockFindMany.mockClear();
  const res = await GET(new NextRequest(`http://localhost/api/showcase${query}`));
  expect(res.status).toBe(200);
  const cache = res.headers.get('cache-control');
  const call = mockFindMany.mock.calls[0];
  if (!call) {
    expect((await res.json()).data).toEqual({ items: [], total: 0, hasMore: false });
    return { cohortId: 'empty', cache };
  }
  const where = call[0].where as { project?: { cohortId: string } };
  return { cohortId: where.project?.cohortId ?? 'all', cache };
}

beforeEach(() => {
  mockState.session = null;
  mockState.enabled = true;
  mockState.memberships = [];
  mockGetSession.mockClear();
});

describe('GET /api/showcase batch filter', () => {
  it('never looks up a session without a batch filter', async () => {
    expect((await list('?tag=web')).cohortId).toBe('all');
    expect(mockGetSession).not.toHaveBeenCalled();
  });

  // A load-more page after a logout mid-scroll lands here: it must not page on into the unfiltered list.
  it('gives signed-out visitors an empty page, the same for a real batch and a made-up one', async () => {
    expect(await list('?cohortId=c1')).toEqual({ cohortId: 'empty', cache: 'private, no-store' });
    expect(await list('?cohortId=nope')).toEqual({ cohortId: 'empty', cache: 'private, no-store' });
  });

  it('gives a student an empty page, even on their own batch', async () => {
    as('USER', [{ role: 'STUDENT', cohort: { id: 'c1', name: 'FSD Jan 2027' } }]);
    expect((await list('?cohortId=c1')).cohortId).toBe('empty');
  });

  it('applies any batch for an admin', async () => {
    as('CONTRIBUTOR');
    expect(await list('?cohortId=c2')).toEqual({ cohortId: 'c2', cache: 'private, no-store' });
    expect((await list('?cohortId=nope')).cohortId).toBe('empty');
  });

  it("applies a mentor's own batch only, and only while batches are on", async () => {
    as('USER', [{ role: 'MENTOR', cohort: { id: 'c1', name: 'FSD Jan 2027' } }]);
    expect((await list('?cohortId=c1')).cohortId).toBe('c1');
    expect((await list('?cohortId=c2')).cohortId).toBe('empty');
    mockState.enabled = false;
    expect((await list('?cohortId=c1')).cohortId).toBe('empty');
  });

  it('keeps the other filters next to the batch', async () => {
    as('CONTRIBUTOR');
    await list('?cohortId=c1&tag=web&q=todo');
    expect(mockFindMany.mock.calls[0][0].where).toMatchObject({ isPublished: true, tags: { has: 'web' }, project: { cohortId: 'c1' }, OR: expect.any(Array) });
  });
});
