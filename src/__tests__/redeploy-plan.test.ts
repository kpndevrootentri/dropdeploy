import { planRedeployAll, type RedeployCandidate } from '@/services/admin/redeploy-plan';

function project(overrides: Partial<RedeployCandidate>): RedeployCandidate {
  return {
    id: 'p',
    name: 'site',
    slug: 'site',
    type: 'NEXTJS',
    source: 'GITHUB',
    githubUrl: 'https://github.com/acme/site',
    userId: 'u1',
    ownerEmail: 'dev@entri.me',
    lastStatus: 'DEPLOYED',
    ...overrides,
  };
}

describe('planRedeployAll', () => {
  const projects = [
    project({ id: 'ok' }),
    project({ id: 'failed-last-time', lastStatus: 'FAILED' }),
    project({ id: 'upload', source: 'UPLOAD', githubUrl: null }),
    project({ id: 'no-repo', githubUrl: null }),
    project({ id: 'never', lastStatus: null }),
    project({ id: 'busy' }),
    project({ id: 'gitlab-django', source: 'GITLAB', type: 'DJANGO' }),
  ];

  it('rebuilds deployed repository projects and says why it skips the rest', () => {
    const { eligible, skipped } = planRedeployAll(projects, new Set(['busy']), {});
    expect(eligible.map((p) => p.id)).toEqual(['ok', 'failed-last-time', 'gitlab-django']);
    expect(Object.fromEntries(skipped.map((s) => [s.project.id, s.reason]))).toEqual({
      upload: expect.stringMatching(/upload/i),
      'no-repo': 'No repository URL',
      never: 'Never deployed',
      busy: 'A deploy is already queued or building',
    });
  });

  it('leaves projects outside the filters out of both lists', () => {
    const { eligible, skipped } = planRedeployAll(projects, new Set(), { source: 'GITLAB', type: 'DJANGO' });
    expect(eligible.map((p) => p.id)).toEqual(['gitlab-django']);
    expect(skipped).toEqual([]);
  });
});
