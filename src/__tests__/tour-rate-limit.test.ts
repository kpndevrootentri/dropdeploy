import { checkTourEndRateLimit } from '@/lib/rate-limit';

describe('tour-end rate limit', () => {
  it('allows 10 per minute per user, and counts each user separately', () => {
    for (let i = 0; i < 10; i++) expect(checkTourEndRateLimit('user-a')).toBeNull();
    expect(checkTourEndRateLimit('user-a')?.status).toBe(429);
    // A classmate on the same network is unaffected.
    expect(checkTourEndRateLimit('user-b')).toBeNull();
  });
});
