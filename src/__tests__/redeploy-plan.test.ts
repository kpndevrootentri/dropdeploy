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
    stoppedAt: null,
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
    project({ id: 'stopped', stoppedAt: new Date('2026-11-01T00:00:00Z') }),
    // A later deploy failed, so the stopped container never came back.
    project({ id: 'stopped-then-failed', lastStatus: 'FAILED', stoppedAt: new Date('2026-11-01T00:00:00Z') }),
  ];

  it('rebuilds deployed repository projects and says why it skips the rest', () => {
    const { eligible, skipped } = planRedeployAll(projects, new Set(['busy']), {});
    expect(eligible.map((p) => p.id)).toEqual(['ok', 'failed-last-time', 'gitlab-django']);
    expect(Object.fromEntries(skipped.map((s) => [s.project.id, s.reason]))).toEqual({
      upload: expect.stringMatching(/upload/i),
      'no-repo': 'No repository URL',
      never: 'Never deployed',
      busy: 'A deploy is already queued or building',
      stopped: 'Stopped by an admin; restart it first',
      'stopped-then-failed': 'Stopped by an admin; restart it first',
    });
  });

  it('limits a confirmed run to the previewed projects, still skipping any that became busy', () => {
    const { eligible, skipped } = planRedeployAll(projects, new Set(['busy']), { projectIds: ['ok', 'busy'] });
    expect(eligible.map((p) => p.id)).toEqual(['ok']);
    expect(skipped.map((s) => s.project.id)).toEqual(['busy']);
  });

  it('skips a previewed project that an admin stopped before the run was confirmed', () => {
    const { eligible, skipped } = planRedeployAll(projects, new Set(), { projectIds: ['ok', 'stopped'] });
    expect(eligible.map((p) => p.id)).toEqual(['ok']);
    expect(skipped).toEqual([{ project: expect.objectContaining({ id: 'stopped' }), reason: 'Stopped by an admin; restart it first' }]);
  });

  it('leaves projects outside the filters out of both lists', () => {
    const { eligible, skipped } = planRedeployAll(projects, new Set(), { source: 'GITLAB', type: 'DJANGO' });
    expect(eligible.map((p) => p.id)).toEqual(['gitlab-django']);
    expect(skipped).toEqual([]);
  });
});
