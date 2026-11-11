const mockSession = { userId: 'u1', email: 'dev@entri.me', role: 'USER', mustResetPassword: false };
jest.mock('@/lib/get-session', () => ({ getSession: async () => mockSession }));
const mockGetLogs = jest.fn(async () => 'log');
jest.mock('@/services/admin', () => ({ adminService: { getProjectContainerLogs: mockGetLogs } }));

import { NextRequest } from 'next/server';
import { GET } from '@/app/api/admin/projects/[projectId]/container/logs/route';

const get = (query = '') => GET(
  new NextRequest(`http://localhost/api/admin/projects/p1/container/logs${query}`),
  { params: Promise.resolve({ projectId: 'p1' }) },
);

describe('GET /api/admin/projects/[projectId]/container/logs', () => {
  afterEach(() => {
    mockGetLogs.mockClear();
    mockSession.role = 'USER';
  });

  it('refuses anyone who is not a contributor, without reading the logs', async () => {
    const res = await get();
    expect(res.status).toBe(403);
    expect(mockGetLogs).not.toHaveBeenCalled();
  });

  it.each([['', 200], ['?tail=100', 100], ['?tail=9999', 500], ['?tail=0', 1], ['?tail=abc', 200]])(
    'reads %p as a tail of %p lines and records who asked',
    async (query, tail) => {
      mockSession.role = 'CONTRIBUTOR';
      const res = await get(query);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true, data: { logs: 'log', tail } });
      expect(mockGetLogs).toHaveBeenCalledWith('p1', tail, 'u1');
    },
  );
});
