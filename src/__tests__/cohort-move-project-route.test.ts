const mockSession = { userId: 'admin', email: 'admin@entri.me', role: 'CONTRIBUTOR', mustResetPassword: false };
jest.mock('@/lib/get-session', () => ({ getSession: async () => mockSession }));
const mockMoveProject = jest.fn(async (_from: string, _projectId: string, to: string) => ({ id: to, name: 'FSD Feb 2027' }));
const mockMoveTargets = jest.fn(async () => [{ id: 'c2', name: 'FSD Feb 2027', program: 'Full Stack' }]);
jest.mock('@/services/cohort', () => ({ cohortService: { moveProject: mockMoveProject, moveTargets: mockMoveTargets } }));

import { NextRequest } from 'next/server';
import { ConflictError, NotFoundError } from '@/lib/errors';
import { GET, PATCH } from '@/app/api/admin/cohorts/[cohortId]/projects/[projectId]/route';

function patch(role: string, body: unknown = { toCohortId: 'c2' }): Promise<Response> {
  mockSession.role = role;
  return PATCH(
    new NextRequest('http://localhost/api/admin/cohorts/c1/projects/p1', { method: 'PATCH', body: JSON.stringify(body) }),
    { params: Promise.resolve({ cohortId: 'c1', projectId: 'p1' }) },
  );
}

describe('PATCH /api/admin/cohorts/[cohortId]/projects/[projectId]', () => {
  beforeEach(() => mockMoveProject.mockClear());

  it('moves the project for an admin and returns the new batch', async () => {
    const res = await patch('CONTRIBUTOR');
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ cohortId: 'c2', name: 'FSD Feb 2027' });
    expect(mockMoveProject).toHaveBeenCalledWith('c1', 'p1', 'c2', 'admin');
  });

  it('refuses everyone but admins, mentors included, before doing anything', async () => {
    const res = await patch('USER');
    expect(res.status).toBe(403);
    expect(mockMoveProject).not.toHaveBeenCalled();
  });

  it.each([[{}], [{ toCohortId: '' }], [{ toCohortId: 42 }]])('rejects a bad body %j with 400', async (body) => {
    expect((await patch('CONTRIBUTOR', body)).status).toBe(400);
    expect(mockMoveProject).not.toHaveBeenCalled();
  });

  it.each([
    [new ConflictError('The owner of portfolio is not a student in FSD Feb 2027. Add the student to that batch first.'), 409],
    [new ConflictError('FSD Feb 2027 is archived'), 409],
    [new ConflictError('The project is already in this batch'), 409],
    [new NotFoundError('Target batch'), 404],
  ])('passes the refusal "%s" on with its status and message', async (error, status) => {
    mockMoveProject.mockRejectedValueOnce(error);
    const res = await patch('CONTRIBUTOR');
    expect(res.status).toBe(status);
    expect((await res.json()).error.message).toBe(error.message);
  });
});

describe('GET /api/admin/cohorts/[cohortId]/projects/[projectId]', () => {
  const get = (role: string): Promise<Response> => {
    mockSession.role = role;
    return GET(new NextRequest('http://localhost/api/admin/cohorts/c1/projects/p1'), { params: Promise.resolve({ cohortId: 'c1', projectId: 'p1' }) });
  };

  it('lists the move targets for an admin and refuses everyone else', async () => {
    const res = await get('CONTRIBUTOR');
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual([{ id: 'c2', name: 'FSD Feb 2027', program: 'Full Stack' }]);
    expect(mockMoveTargets).toHaveBeenCalledWith('c1', 'p1');
    mockMoveTargets.mockClear();
    expect((await get('USER')).status).toBe(403);
    expect(mockMoveTargets).not.toHaveBeenCalled();
  });
});
