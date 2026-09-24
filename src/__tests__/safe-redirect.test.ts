import { safeRedirectPath } from '@/lib/safe-redirect';

describe('safeRedirectPath', () => {
  it.each(['/dashboard', '/projects/abc?tab=logs', '/settings#git'])('keeps same-origin path %s', (p) => {
    expect(safeRedirectPath(p)).toBe(p);
  });

  it.each(['https://evil.tld/login', '//evil.tld', '/\\evil.tld', 'javascript:alert(1)', '', null, undefined])(
    'falls back for %p',
    (p) => expect(safeRedirectPath(p)).toBe('/dashboard'),
  );
});
