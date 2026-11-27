const mockSession = { userId: 'owner', email: 'o@entri.me', role: 'USER', mustResetPassword: false };
jest.mock('@/lib/get-session', () => ({ getSession: async () => mockSession }));
// Only the project lookup is reached: these requests are refused before any hook is read or written.
jest.mock('@/lib/prisma', () => ({
  prisma: { project: { findUnique: async ({ where }: { where: { id: string } }) => ({ id: where.id, userId: 'owner', name: 'Shop', slug: 'shop' }) } },
}));

import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/projects/[id]/notifications/route';
import { DELETE } from '@/app/api/projects/[id]/notifications/[hookId]/route';

const ctx = { params: Promise.resolve({ id: 'p1' }) };
const post = (url: string): Promise<Response> =>
  POST(new NextRequest('http://localhost/api/projects/p1/notifications', { method: 'POST', body: JSON.stringify({ url }) }), ctx);

describe('/api/projects/:id/notifications', () => {
  it("returns 404 on another user's project", async () => {
    mockSession.userId = 'intruder';
    expect((await GET(new NextRequest('http://localhost/api/projects/p1/notifications'), ctx)).status).toBe(404);
    expect((await post('https://example.com/hook')).status).toBe(404);
    const del = await DELETE(new NextRequest('http://localhost/api/projects/p1/notifications/h1', { method: 'DELETE' }), {
      params: Promise.resolve({ id: 'p1', hookId: 'h1' }),
    });
    expect(del.status).toBe(404);
  });

  it('refuses a URL that is not https with 400, and the 11th add in a minute with 429', async () => {
    mockSession.userId = 'owner';
    const first = await post('http://example.com/hook');
    expect(first.status).toBe(400);
    expect((await first.json()).error.message).toMatch(/https:\/\//);
    for (let i = 2; i <= 10; i++) expect((await post('http://example.com/hook')).status).toBe(400);
    expect((await post('http://example.com/hook')).status).toBe(429);
  });
});
