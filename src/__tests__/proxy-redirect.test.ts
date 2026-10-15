import { NextRequest } from 'next/server';
import { publicLocation } from '@/lib/upstream-location';

const findFirst = jest.fn();

jest.mock('@/lib/prisma', () => ({
  prisma: {
    deployment: { findFirst: (...args: unknown[]) => findFirst(...args) },
    proxyHit: { create: () => Promise.resolve() },
  },
}));

jest.mock('@/lib/config', () => ({
  getConfig: () => ({ BASE_DOMAIN: 'app.test', NODE_ENV: 'production' }),
}));

jest.mock('@/services/project-access', () => ({ projectAccessService: {} }));
jest.mock('@/services/auth', () => ({ authService: {} }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { GET } = require('@/app/api/proxy/[slug]/[[...path]]/route');

const PORT = 4123;

describe('publicLocation', () => {
  const origin = 'https://shop.app.test';

  it('moves a Location on the internal address onto the public origin', () => {
    expect(publicLocation(`http://127.0.0.1:${PORT}/items/?a=1`, PORT, origin)).toBe(
      'https://shop.app.test/items/?a=1',
    );
    expect(publicLocation(`http://127.0.0.1:${PORT}`, PORT, origin)).toBe(origin);
  });

  it('leaves relative, external and other-port locations alone', () => {
    expect(publicLocation('/login', PORT, origin)).toBe('/login');
    expect(publicLocation('https://github.com/login', PORT, origin)).toBe('https://github.com/login');
    expect(publicLocation(`http://127.0.0.1:${PORT}1/x`, PORT, origin)).toBe(`http://127.0.0.1:${PORT}1/x`);
  });
});

describe('proxy route redirects', () => {
  const realFetch = global.fetch;
  let upstreamInit: RequestInit | undefined;

  beforeEach(() => {
    findFirst.mockResolvedValue({
      containerPort: PORT,
      servingMethod: 'CONTAINER',
      projectId: 'p1',
      project: { id: 'p1', isPrivate: false, userId: 'u1' },
    });
    global.fetch = jest.fn(async (_url: unknown, init?: RequestInit) => {
      upstreamInit = init;
      const headers = new Headers({ location: `http://127.0.0.1:${PORT}/wp-admin/` });
      headers.append('set-cookie', 'wordpress_sec=a; Path=/; HttpOnly');
      headers.append('set-cookie', 'wordpress_logged_in=b; Path=/');
      return new Response(null, { status: 302, headers });
    }) as typeof fetch;
  });

  afterAll(() => {
    global.fetch = realFetch;
  });

  it('relays a 302 with every cookie and a public Location', async () => {
    const request = new NextRequest('https://shop.app.test/api/proxy/shop/wp-login.php', {
      method: 'GET',
      headers: { host: 'shop.app.test' },
    });

    const res = await GET(request, { params: Promise.resolve({ slug: 'shop', path: ['wp-login.php'] }) });

    expect(upstreamInit?.redirect).toBe('manual');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://shop.app.test/wp-admin/');
    expect(res.headers.getSetCookie()).toEqual([
      'wordpress_sec=a; Path=/; HttpOnly',
      'wordpress_logged_in=b; Path=/',
    ]);
  });
});
