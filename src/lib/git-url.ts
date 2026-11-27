import { ValidationError } from '@/lib/errors';

/**
 * Hosts we are willing to clone from. A user's OAuth token is only ever embedded
 * into a clone URL whose host is in this set — never an arbitrary host.
 */
export const ALLOWED_GIT_HOSTS = new Set([
  'github.com',
  'www.github.com',
  'gitlab.com',
  'www.gitlab.com',
]);

export type GitSource = 'GITHUB' | 'GITLAB';

export interface ParsedRepoUrl {
  /** The parsed (validated) URL. Safe to mutate and stringify for cloning. */
  url: URL;
  /** Hostname normalised without a leading "www.". */
  host: string;
}

/**
 * Validates that a repository URL is safe to clone and safe to embed a token into.
 *
 * Rejects everything that enabled H2:
 *  - non-https schemes incl. dangerous git transports (`ext::`, `file://`, `ssh://`,
 *    `git://`) — `ext::` in particular is remote-helper RCE on the host;
 *  - hosts outside the allowlist (token exfiltration to attacker hosts, SSRF to
 *    internal/metadata addresses);
 *  - URLs that already carry embedded credentials;
 *  - URLs that don't point at a concrete owner/repo.
 *
 * Throws {@link ValidationError} on any violation.
 */
export function parseSafeRepoUrl(raw: string): ParsedRepoUrl {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ValidationError('Repository URL is not a valid URL');
  }

  if (url.protocol !== 'https:') {
    throw new ValidationError('Repository URL must use https://');
  }
  if (url.username || url.password) {
    throw new ValidationError('Repository URL must not contain embedded credentials');
  }

  const host = url.hostname.toLowerCase();
  if (!ALLOWED_GIT_HOSTS.has(host)) {
    throw new ValidationError('Repository must be hosted on github.com or gitlab.com');
  }

  // Require at least /owner/repo so we never inject a token into a host-root URL.
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length < 2) {
    throw new ValidationError(
      'Repository URL must point to a specific repository (e.g. https://github.com/owner/repo)',
    );
  }

  return { url, host: host.replace(/^www\./, '') };
}

/**
 * Returns the normalised "owner/repo" path for a validated repo URL, lowercased
 * and without a trailing ".git". Used to match an incoming webhook's
 * `repository.full_name` against a project's stored `githubUrl`.
 * Throws {@link ValidationError} (via {@link parseSafeRepoUrl}) on an unsafe URL.
 */
export function repoFullNameFromUrl(raw: string): string {
  const { url } = parseSafeRepoUrl(raw);
  const [owner, repo] = url.pathname.split('/').filter(Boolean);
  return `${owner}/${repo.replace(/\.git$/, '')}`.toLowerCase();
}

/** True when the URL host matches the declared source (github.com ↔ GITHUB, etc.). */
export function hostMatchesSource(host: string, source: GitSource): boolean {
  const normalized = host.replace(/^www\./, '');
  return source === 'GITHUB' ? normalized === 'github.com' : normalized === 'gitlab.com';
}

const SHA = /^[0-9a-f]{7,64}$/i;

/**
 * Link to the code changes between two commits of a project's repo on
 * github.com or gitlab.com, or null when there is nothing to link (an upload,
 * no previous commit, the same commit, or a repo URL outside the allowlist).
 * Accepts https, `.git` and ssh (`git@host:owner/repo`) forms of the repo URL.
 */
export function compareUrl({ source, repoUrl, fromSha, toSha }: {
  source: string | undefined;
  repoUrl: string | null;
  fromSha: string | null | undefined;
  toSha: string | null;
}): string | null {
  if ((source !== 'GITHUB' && source !== 'GITLAB') || !repoUrl || !fromSha || !toSha) return null;
  if (!SHA.test(fromSha) || !SHA.test(toSha) || fromSha === toSha) return null;
  let parsed: ParsedRepoUrl;
  try {
    parsed = parseSafeRepoUrl(repoUrl.trim().replace(/^(?:ssh:\/\/)?git@([^:/]+)[:/]/, 'https://$1/'));
  } catch {
    return null;
  }
  if (!hostMatchesSource(parsed.host, source)) return null;
  const segments = parsed.url.pathname.split('/').filter(Boolean);
  const range = `${fromSha}...${toSha}`;
  if (source === 'GITHUB') {
    return `https://github.com/${segments[0]}/${segments[1].replace(/\.git$/, '')}/compare/${range}`;
  }
  // GitLab paths are group/subgroup.../project; anything after "/-/" is a page inside it.
  const dash = segments.indexOf('-');
  const path = (dash === -1 ? segments : segments.slice(0, dash)).join('/').replace(/\.git$/, '');
  return path.includes('/') ? `https://gitlab.com/${path}/-/compare/${range}` : null;
}
