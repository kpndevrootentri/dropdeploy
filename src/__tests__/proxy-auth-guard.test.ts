import { readdirSync } from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';
import * as jose from 'jose';
import { proxy } from '@/proxy';

const SECRET = 'test-secret';

beforeAll(() => {
  process.env.BASE_DOMAIN = 'example.test';
  process.env.JWT_SECRET = SECRET;
  delete process.env.CUSTOM_DOMAINS_ENABLED;
});

async function get(path: string, cookie?: string) {
  const headers: Record<string, string> = { host: 'localhost:3000' };
  if (cookie) headers.cookie = cookie;
  return proxy(new NextRequest(`http://localhost:3000${path}`, { headers }));
}

describe('login guard on platform pages', () => {
  // Every top-level page of the (dashboard) route group renders the dashboard shell.
  it.each(['/dashboard', '/dashboard/admin', '/settings', '/projects/abc'])(
    'sends a signed-out visitor from %s to the login page',
    async (path) => {
      const res = await get(path);
      expect(res.status).toBe(307);
      const location = new URL(res.headers.get('location') ?? '');
      expect(location.pathname).toBe('/login');
      expect(location.searchParams.get('from')).toBe(path);
    },
  );

  it('covers every top-level page of the (dashboard) route group', async () => {
    // A page added there but missing from the login list fails here, not in production.
    const pages = readdirSync(path.join(process.cwd(), 'src/app/(dashboard)'), { withFileTypes: true })
      // Route groups "(x)" and private "_x" folders are not URL segments.
      .filter((entry) => entry.isDirectory() && !/^[(_]/.test(entry.name))
      .map((entry) => `/${entry.name}`);
    expect(pages.length).toBeGreaterThan(0);
    for (const page of pages) expect((await get(page)).status).toBe(307);
  });

  it('leaves public pages, and paths that only look similar, open', async () => {
    for (const path of ['/', '/explore', '/docs', '/login', '/projectsx', '/settingsy']) {
      expect((await get(path)).status).toBe(200);
    }
  });

  it('lets a signed-in user through', async () => {
    const token = await new jose.SignJWT({ userId: 'u1', role: 'USER' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(SECRET));
    for (const path of ['/dashboard', '/settings', '/projects/abc']) {
      expect((await get(path, `auth-token=${token}`)).status).toBe(200);
    }
  });
});

describe('admin pages while viewing as a user', () => {
  it('sends a view-as session away from admin pages, whatever role it claims', async () => {
    const token = await new jose.SignJWT({ sub: 'u1', role: 'CONTRIBUTOR', imp: 'admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(SECRET));
    const res = await get('/dashboard/admin/users', `auth-token=${token}`);
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location') ?? '').pathname).toBe('/dashboard');
  });
});
