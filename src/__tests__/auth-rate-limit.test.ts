import { checkLoginRateLimit, checkRegisterRateLimit } from '@/lib/rate-limit';

describe('auth rate limits', () => {
  it('blocks an IP after 20 login attempts in a minute', () => {
    for (let i = 0; i < 20; i++) {
      expect(checkLoginRateLimit('198.51.100.1', `user${i}@x.test`)).toBeNull();
    }
    expect(checkLoginRateLimit('198.51.100.1', 'another@x.test')?.status).toBe(429);
  });

  it('blocks guessing one account from many IPs', () => {
    for (let i = 0; i < 20; i++) {
      expect(checkLoginRateLimit(`203.0.113.${i}`, 'Victim@X.test')).toBeNull();
    }
    expect(checkLoginRateLimit('203.0.113.99', 'victim@x.test')?.status).toBe(429);
  });

  it('allows 5 registrations per IP per hour', () => {
    for (let i = 0; i < 5; i++) expect(checkRegisterRateLimit('192.0.2.7')).toBeNull();
    expect(checkRegisterRateLimit('192.0.2.7')?.status).toBe(429);
  });
});
