import { NextRequest } from 'next/server';

const findFirst = jest.fn();
const verifySession = jest.fn();
const canView = jest.fn();

jest.mock('@/lib/prisma', () => ({
  prisma: {
    deployment: { findFirst: (...args: unknown[]) => findFirst(...args) },
    proxyHit: { create: () => Promise.resolve() },
  },
}));

jest.mock('@/lib/config', () => ({
  getConfig: () => ({ BASE_DOMAIN: 'app.test', NODE_ENV: 'production' }),
}));

jest.mock('@/services/project-access', () => ({ projectAccessService: { canView: (...args: unknown[]) => canView(...args) } }));
jest.mock('@/services/auth', () => ({ authService: { verifySession: (...args: unknown[]) => verifySession(...args) } }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { GET } = require('@/app/api/proxy/[slug]/[[...path]]/route');

describe('private site gate', () => {
  const realFetch = global.fetch;
  const upstream = jest.fn(async () => new Response('site', { status: 200 }));

  beforeEach(() => {
    jest.clearAllMocks();
    findFirst.mockResolvedValue({
      containerPort: 4123,
      servingMethod: 'CONTAINER',
      projectId: 'p1',
      project: { id: 'p1', isPrivate: true, userId: 'u1', cohortId: 'c1' },
    });
    canView.mockResolvedValue(true);
    global.fetch = upstream as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = realFetch;
  });

  const open = () =>
    GET(
      new NextRequest('https://shop.app.test/', { headers: { host: 'shop.app.test', cookie: 'auth-token=t' } }),
      { params: Promise.resolve({ slug: 'shop', path: ['index.html'] }) },
    );

  it('serves someone the access rules allow', async () => {
    verifySession.mockResolvedValue({ userId: 'm1', email: 'mentor@entri.me', role: 'USER', mustResetPassword: false });
    const res = await open();
    expect(res.status).toBe(200);
    expect(canView).toHaveBeenCalled();
  });

  it('refuses a session still on an invited or admin-reset password, before any access check', async () => {
    verifySession.mockResolvedValue({ userId: 'm1', email: 'mentor@entri.me', role: 'USER', mustResetPassword: true });
    const res = await open();
    expect(res.status).not.toBe(200);
    expect(canView).not.toHaveBeenCalled();
    expect(upstream).not.toHaveBeenCalled();
  });
});
