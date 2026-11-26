import { apiTokenBlockReason } from '@/lib/api-token-scope';

const ACCOUNT_ONLY = /cannot use this endpoint/;
const DEPLOY_ONLY = /can only deploy/;

describe('apiTokenBlockReason', () => {
  it.each([
    ['GET', '/api/projects'],
    ['POST', '/api/projects/upload'],
    ['POST', '/api/projects/p1/upload'],
    ['POST', '/api/projects/p1/deploy'],
    ['GET', '/api/projects/p1/deployments'],
    ['GET', '/api/projects/p1/deployments/d1/logs'],
    ['GET', '/api/projects/p1/deployments/d1/logs/stream'],
    ['POST', '/api/projects/p1/deployments/d1/rollback'],
    ['POST', '/api/projects/p1/deployments/d1/cancel'],
    ['GET', '/api/projects/p1'],
    ['HEAD', '/api/projects/p1'],
    ['GET', '/api/projects/p1/'],
  ])('a Deploy only token may %s %s', (method, path) => {
    expect(apiTokenBlockReason('DEPLOY', method, path)).toBeNull();
  });

  it.each([
    ['GET', '/api/projects/p1/env-vars'],
    ['POST', '/api/projects/p1/env-vars'],
    ['DELETE', '/api/projects/p1'],
    ['PATCH', '/api/projects/p1'],
    ['POST', '/api/projects/p1/domains'],
    ['POST', '/api/projects/p1/access'],
    ['POST', '/api/projects/p1/deployments/d1/retry'],
    ['GET', '/api/projects/p1/analytics'],
    ['DELETE', '/api/projects/p1/deployments'],
    // :id is one segment only.
    ['GET', '/api/projects/p1/extra/deployments'],
    ['GET', '/api/showcase'],
    // Both clone or read git repositories with the user's linked provider token.
    ['POST', '/api/projects'],
    ['POST', '/api/detect-type'],
  ])('a Deploy only token may not %s %s', (method, path) => {
    expect(apiTokenBlockReason('DEPLOY', method, path)).toMatch(DEPLOY_ONLY);
  });

  it.each([
    ['DELETE', '/api/projects/p1'],
    ['POST', '/api/projects/p1/env-vars'],
    ['POST', '/api/projects/p1/domains'],
    ['GET', '/api/projects/p1/analytics'],
  ])('a Full access token may %s %s', (method, path) => {
    expect(apiTokenBlockReason('FULL', method, path)).toBeNull();
  });

  it.each([
    ['GET', '/api/admin/users'],
    ['GET', '/api/admin'],
    ['POST', '/api/auth/reset-password'],
    ['GET', '/api/auth/session'],
    ['GET', '/api/tokens'],
    ['POST', '/api/tokens'],
    ['DELETE', '/api/tokens/t1'],
    ['POST', '/api/onboarding/tour'],
    ['GET', '/api/cohorts'],
    ['POST', '/api/cohorts/join'],
    ['GET', '/api/git-providers'],
    ['GET', '/api/git-providers/github/repos'],
    ['GET', '/api/projects/p1/terminal'],
    ['GET', '/api/admin/users/'],
  ])('no token may %s %s', (method, path) => {
    expect(apiTokenBlockReason('FULL', method, path)).toMatch(ACCOUNT_ONLY);
    expect(apiTokenBlockReason('DEPLOY', method, path)).toMatch(ACCOUNT_ONLY);
  });

  it.each([
    '/api/projects//p1',
    '/api/projects/./p1',
    '/api/projects/x/../p1',
    '/api/projects/p1/..',
    '/api/projects/%2e%2e/admin',
    '/api/projects/p1%2Fdeploy',
    '/api/projects/p1%5cdeploy',
    // Next decodes these to /api/tokens, /api/admin/users and .../terminal before routing.
    '/api/t%6fkens',
    '/api/%61dmin/users',
    '/api/projects/x/termin%61l',
  ])('refuses the ambiguous path %s instead of normalising it', (path) => {
    expect(apiTokenBlockReason('FULL', 'GET', path)).toMatch(ACCOUNT_ONLY);
    expect(apiTokenBlockReason('DEPLOY', 'GET', path)).toMatch(ACCOUNT_ONLY);
  });

  it('strips only one trailing slash', () => {
    expect(apiTokenBlockReason('DEPLOY', 'GET', '/api/projects/')).toBeNull();
    expect(apiTokenBlockReason('DEPLOY', 'GET', '/api/projects//')).toMatch(ACCOUNT_ONLY);
  });

  it('never allows OPTIONS', () => {
    expect(apiTokenBlockReason('FULL', 'OPTIONS', '/api/projects')).toMatch(ACCOUNT_ONLY);
    expect(apiTokenBlockReason('DEPLOY', 'OPTIONS', '/api/projects')).toMatch(ACCOUNT_ONLY);
  });

  it('does not mistake a lookalike path for an account endpoint', () => {
    expect(apiTokenBlockReason('FULL', 'GET', '/api/administrators')).toBeNull();
    expect(apiTokenBlockReason('FULL', 'GET', '/api/tokensx')).toBeNull();
  });
});
