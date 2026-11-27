import { NextRequest } from 'next/server';
import nextConfig from '../../next.config.js';
import { proxy } from '@/proxy';

describe('tenant rewrite under next start -H 127.0.0.1', () => {
  beforeAll(() => {
    process.env.BASE_DOMAIN = 'app.test';
    // What skipProxyUrlNormalize builds into the proxy: request.url stays the URL Next is bound to.
    process.env.__NEXT_NO_MIDDLEWARE_URL_NORMALIZE = 'true';
  });

  afterAll(() => {
    delete process.env.__NEXT_NO_MIDDLEWARE_URL_NORMALIZE;
  });

  it("keeps request.url's origin, so Next serves the rewrite itself with the tenant Host", async () => {
    expect(nextConfig.skipProxyUrlNormalize).toBe(true);
    // How Next hands proxy.ts a request behind the TLS edge when bound to 127.0.0.1.
    const res = await proxy(new NextRequest('https://127.0.0.1:3000/a/?q=1', { headers: { host: 'shop.app.test' } }));
    expect(res.headers.get('x-middleware-rewrite')).toBe('https://127.0.0.1:3000/api/proxy/shop/a/?q=1');
  });
});
