import { parseSafeRepoUrl, hostMatchesSource, repoFullNameFromUrl, compareUrl } from '@/lib/git-url';
import { ValidationError } from '@/lib/errors';

describe('parseSafeRepoUrl', () => {
  it('accepts a normal github https clone URL', () => {
    const { host } = parseSafeRepoUrl('https://github.com/owner/repo.git');
    expect(host).toBe('github.com');
  });

  it('accepts a gitlab https URL and a www. host', () => {
    expect(parseSafeRepoUrl('https://gitlab.com/group/repo').host).toBe('gitlab.com');
    expect(parseSafeRepoUrl('https://www.github.com/owner/repo').host).toBe('github.com');
  });

  it.each([
    ['ext:: RCE transport', 'ext::sh -c "touch /tmp/pwned"'],
    ['file:// local read', 'file:///etc/passwd'],
    ['ssh transport', 'ssh://git@github.com/owner/repo.git'],
    ['git transport', 'git://github.com/owner/repo.git'],
    ['plain http', 'http://github.com/owner/repo.git'],
    ['arbitrary host (token exfil)', 'https://evil.example.com/owner/repo.git'],
    ['internal SSRF host', 'https://169.254.169.254/latest/meta-data'],
    ['embedded credentials', 'https://user:pass@github.com/owner/repo.git'],
    ['host root, no repo', 'https://github.com/'],
    ['owner only, no repo', 'https://github.com/owner'],
    ['not a url', 'not-a-url'],
  ])('rejects %s', (_label, input) => {
    expect(() => parseSafeRepoUrl(input)).toThrow(ValidationError);
  });
});

describe('repoFullNameFromUrl', () => {
  it('returns lowercased owner/repo without .git', () => {
    expect(repoFullNameFromUrl('https://github.com/Owner/Repo.git')).toBe('owner/repo');
    expect(repoFullNameFromUrl('https://www.github.com/Owner/Repo')).toBe('owner/repo');
  });

  it('throws on an unsafe URL', () => {
    expect(() => repoFullNameFromUrl('https://evil.example.com/o/r')).toThrow(ValidationError);
  });
});

describe('hostMatchesSource', () => {
  it('matches host to declared source', () => {
    expect(hostMatchesSource('github.com', 'GITHUB')).toBe(true);
    expect(hostMatchesSource('gitlab.com', 'GITLAB')).toBe(true);
    expect(hostMatchesSource('github.com', 'GITLAB')).toBe(false);
    expect(hostMatchesSource('gitlab.com', 'GITHUB')).toBe(false);
  });
});

describe('compareUrl', () => {
  const a = 'a'.repeat(40);
  const b = 'b'.repeat(40);
  const gh = `https://github.com/owner/repo/compare/${a}...${b}`;

  it.each([
    'https://github.com/owner/repo',
    'https://github.com/owner/repo.git',
    'https://www.github.com/owner/repo/',
    'https://github.com/owner/repo/tree/main',
    'git@github.com:owner/repo.git',
    'ssh://git@github.com/owner/repo.git',
  ])('builds a GitHub compare link from %s', (repo) => {
    expect(compareUrl({ source: 'GITHUB', repoUrl: repo, fromSha: a, toSha: b })).toBe(gh);
  });

  it.each([
    ['https://gitlab.com/group/repo.git', 'group/repo'],
    ['https://gitlab.com/group/sub/deeper/repo', 'group/sub/deeper/repo'],
    ['https://gitlab.com/group/sub/repo/-/tree/main', 'group/sub/repo'],
    ['git@gitlab.com:group/sub/repo.git', 'group/sub/repo'],
  ])('builds a GitLab compare link from %s', (repo, path) => {
    expect(compareUrl({ source: 'GITLAB', repoUrl: repo, fromSha: a, toSha: b })).toBe(`https://gitlab.com/${path}/-/compare/${a}...${b}`);
  });

  it.each([
    ['upload source', 'UPLOAD', 'https://github.com/owner/repo', a, b],
    ['no source', undefined, 'https://github.com/owner/repo', a, b],
    ['no repo URL', 'GITHUB', null, a, b],
    ['first deployment (no previous commit)', 'GITHUB', 'https://github.com/owner/repo', null, b],
    ['no commit', 'GITHUB', 'https://github.com/owner/repo', a, null],
    ['same commit', 'GITHUB', 'https://github.com/owner/repo', b, b],
    ['non-hex sha', 'GITHUB', 'https://github.com/owner/repo', a, '../../evil'],
    ['foreign host', 'GITHUB', 'https://evil.example.com/owner/repo', a, b],
    ['lookalike host', 'GITHUB', 'https://github.com.evil.example.com/owner/repo', a, b],
    ['userinfo host trick', 'GITHUB', 'https://github.com@evil.example.com/owner/repo', a, b],
    ['foreign ssh host', 'GITHUB', 'git@evil.example.com:owner/repo.git', a, b],
    ['host not matching source', 'GITHUB', 'https://gitlab.com/group/repo', a, b],
    ['plain http', 'GITHUB', 'http://github.com/owner/repo', a, b],
    ['javascript: URL', 'GITHUB', 'javascript:alert(1)//github.com/owner/repo', a, b],
    ['gitlab group only', 'GITLAB', 'https://gitlab.com/group/-/tree/main', a, b],
  ])('returns null for %s', (_label, source, repo, prev, sha) => {
    expect(compareUrl({ source, repoUrl: repo, fromSha: prev, toSha: sha })).toBeNull();
  });
});
