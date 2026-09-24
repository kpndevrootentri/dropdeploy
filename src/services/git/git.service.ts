/**
 * Git service: clone repos once, then pull on subsequent deploys.
 * Repos persist at PROJECTS_DIR/<slug>/ across deployments.
 */

import * as fs from 'fs';
import * as path from 'path';
import { simpleGit } from 'simple-git';
import { getConfig } from '@/lib/config';
import { createLogger } from '@/lib/logger';

const log = createLogger('git');

export interface RepoResult {
  workDir: string;
  commitHash: string;
}

/** HTTPS credentials for a private repo (username is the provider's token user). */
export interface GitCredentials {
  username: string;
  token: string;
}

/**
 * Environment that makes git send `credentials` as an Authorization header,
 * scoped to the repo's own origin, via git's `GIT_CONFIG_*` variables.
 *
 * The alternative — a token embedded in the clone URL — puts it in the git
 * process's argv (readable by every user on the host through `ps`) and writes
 * it into .git/config until something scrubs it. An environment variable is
 * visible only to the service account and root, and never touches disk.
 */
function authEnv(repoUrl: string, credentials?: GitCredentials): Record<string, string> {
  if (!credentials) return {};
  const origin = new URL(repoUrl).origin;
  const basic = Buffer.from(`${credentials.username}:${credentials.token}`).toString('base64');
  return {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: `http.${origin}/.extraHeader`,
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
  };
}

/**
 * Host variables git legitimately needs. Everything else in the service's
 * environment is left out: simple-git refuses to run when variables like
 * EDITOR, PAGER or GIT_SSH are present (they can execute programs), and a
 * PM2-managed process inherits whatever its launching shell had.
 */
const INHERITED_ENV = [
  'PATH', 'HOME', 'USER', 'LANG', 'LC_ALL', 'TMPDIR',
  'SSL_CERT_FILE', 'SSL_CERT_DIR',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
];

function gitEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of INHERITED_ENV) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return {
    ...env,
    GIT_LFS_SKIP_SMUDGE: '1',
    GIT_TERMINAL_PROMPT: '0',
    ...extra,
  };
}

export interface IGitService {
  /**
   * Returns the deterministic work directory for a project.
   */
  getWorkDir(projectSlug: string): string;

  /**
   * Clone (first time) or fetch+reset (subsequent) the repo at the given branch.
   * `credentials`, when given, are sent as an HTTP header and never stored.
   * Returns the work directory path and the HEAD commit SHA.
   */
  ensureRepo(
    repoUrl: string,
    projectSlug: string,
    branch: string,
    credentials?: GitCredentials,
    signal?: AbortSignal,
  ): Promise<RepoResult>;
}

export class GitService implements IGitService {
  getWorkDir(projectSlug: string): string {
    return path.join(getConfig().PROJECTS_DIR, projectSlug);
  }

  async ensureRepo(
    repoUrl: string,
    projectSlug: string,
    branch: string,
    credentials?: GitCredentials,
    signal?: AbortSignal,
  ): Promise<RepoResult> {
    const workDir = this.getWorkDir(projectSlug);

    // Network operations are shallow (the build needs only the tip, and .git
    // never reaches the image), skip LFS payloads and submodules, never prompt,
    // and stop when the deployment job is aborted on timeout.
    const netGit = (baseDir?: string) =>
      simpleGit({
        baseDir,
        abort: signal,
        // Our own GIT_CONFIG_* entry carries the auth header (see authEnv).
        unsafe: { allowUnsafeConfigEnvCount: true },
      }).env(gitEnv(authEnv(repoUrl, credentials)));
    const localGit = (baseDir: string) => simpleGit(baseDir).env(gitEnv());
    await fs.promises.mkdir(getConfig().PROJECTS_DIR, { recursive: true });

    const gitDir = path.join(workDir, '.git');
    let exists = await fs.promises
      .stat(gitDir)
      .then(() => true)
      .catch(() => false);

    // Only reuse a clone of *this* repository. A clone left under the slug by a
    // deleted project (or by a project whose repo URL changed) holds someone
    // else's history, which a fetch+reset would keep in .git. Re-clone instead.
    if (exists) {
      const origin = await localGit(workDir)
        .remote(['get-url', 'origin'])
        .then((url) => (url ?? '').trim())
        .catch(() => '');
      if (origin !== repoUrl) {
        log.info('Existing clone has a different origin, re-cloning', { slug: projectSlug });
        await fs.promises.rm(workDir, { recursive: true, force: true });
        exists = false;
      }
    }

    if (exists) {
      // Repo already cloned – fetch+reset
      log.info('Pulling latest', { slug: projectSlug, branch });
      const git = netGit(workDir);

      await git.raw([
        'config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*',
      ]);
      await git.fetch(['--depth', '1', '--prune', '--no-recurse-submodules', 'origin', branch]);

      try {
        await git.checkout(branch);
      } catch {
        await git.checkoutBranch(branch, `origin/${branch}`);
      }
      await git.reset(['--hard', `origin/${branch}`]);
      // Drop untracked and ignored files too, so the build sees exactly the commit.
      await git.clean('fdx', ['-f']);

      const commitHash = await git.revparse(['HEAD']);
      return { workDir, commitHash: commitHash.trim() };
    } else {
      // First deploy – shallow clone of the one branch
      log.info('Cloning repo', { repoUrl, branch, workDir });
      await netGit().clone(repoUrl, workDir, [
        '-b', branch, '--depth', '1', '--single-branch', '--no-recurse-submodules',
      ]);

      const commitHash = await localGit(workDir).revparse(['HEAD']);
      return { workDir, commitHash: commitHash.trim() };
    }
  }
}

export const gitService = new GitService();
