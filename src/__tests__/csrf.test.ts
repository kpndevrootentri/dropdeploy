import { isForeignOriginMutation } from '@/lib/csrf';

describe('isForeignOriginMutation', () => {
  const HOST = 'app.en3.wtf';

  it('refuses a POST from a sibling tenant subdomain', () => {
    expect(isForeignOriginMutation('POST', HOST, 'https://evil.app.en3.wtf', 'same-site')).toBe(true);
  });

  it('refuses a POST from an unrelated site and from an opaque origin', () => {
    expect(isForeignOriginMutation('DELETE', HOST, 'https://evil.example', 'cross-site')).toBe(true);
    expect(isForeignOriginMutation('POST', HOST, 'null', null)).toBe(true);
  });

  it('allows the dashboard calling its own API', () => {
    expect(isForeignOriginMutation('POST', HOST, 'https://app.en3.wtf', 'same-origin')).toBe(false);
    expect(isForeignOriginMutation('PATCH', 'localhost:3001', 'http://localhost:3001', null)).toBe(false);
  });

  it('treats a different port as a different origin', () => {
    expect(isForeignOriginMutation('POST', 'localhost:3001', 'http://localhost:4000', null)).toBe(true);
  });

  it('never blocks safe methods', () => {
    expect(isForeignOriginMutation('GET', HOST, 'https://evil.app.en3.wtf', 'same-site')).toBe(false);
  });

  it('lets non-browser callers (CLI, webhooks) through', () => {
    expect(isForeignOriginMutation('POST', HOST, null, null)).toBe(false);
  });

  it('falls back to Fetch Metadata when Origin is missing', () => {
    expect(isForeignOriginMutation('POST', HOST, null, 'same-site')).toBe(true);
    expect(isForeignOriginMutation('POST', HOST, null, 'same-origin')).toBe(false);
  });
});
