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

export interface IGitService {
  /**
   * Returns the deterministic work directory for a project.
   */
  getWorkDir(projectSlug: string): string;

  /**
   * Clone (first time) or fetch+reset (subsequent) the repo at the given branch.
   * - authUrl: used for git network operations (may contain embedded token)
   * - cleanUrl: stored as remote origin after clone to scrub the token from .git/config
   * Returns the work directory path and the HEAD commit SHA.
   */
  ensureRepo(
    authUrl: string,
    cleanUrl: string,
    projectSlug: string,
    branch: string,
    signal?: AbortSignal,
  ): Promise<RepoResult>;
}

export class GitService implements IGitService {
  getWorkDir(projectSlug: string): string {
    return path.join(getConfig().PROJECTS_DIR, projectSlug);
  }

  async ensureRepo(
    authUrl: string,
    cleanUrl: string,
    projectSlug: string,
    branch: string,
    signal?: AbortSignal,
  ): Promise<RepoResult> {
    const workDir = this.getWorkDir(projectSlug);

    // Network operations are shallow (the build needs only the tip, and .git
    // never reaches the image), skip LFS payloads and submodules, never prompt,
    // and stop when the deployment job is aborted on timeout.
    const netGit = (baseDir?: string) =>
      simpleGit({ baseDir, abort: signal }).env({
        ...process.env,
        GIT_LFS_SKIP_SMUDGE: '1',
        GIT_TERMINAL_PROMPT: '0',
      });
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
      const origin = await simpleGit(workDir)
        .remote(['get-url', 'origin'])
        .then((url) => (url ?? '').trim())
        .catch(() => '');
      if (origin !== cleanUrl) {
        log.info('Existing clone has a different origin, re-cloning', { slug: projectSlug });
        await fs.promises.rm(workDir, { recursive: true, force: true });
        exists = false;
      }
    }

    if (exists) {
      // Repo already cloned – update remote URL (may need new token) then fetch+reset
      log.info('Pulling latest', { slug: projectSlug, branch });
      const git = netGit(workDir);

      // Update remote to use authUrl for this fetch (token may have rotated)
      await git.remote(['set-url', 'origin', authUrl]);

      await git.raw([
        'config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*',
      ]);

      try {
        await git.fetch(['--depth', '1', '--prune', '--no-recurse-submodules', 'origin', branch]);
      } finally {
        // Scrub token from remote URL immediately after fetch — also when it
        // fails, or the token would stay in .git/config on disk.
        await git.remote(['set-url', 'origin', cleanUrl]);
      }

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
      log.info('Cloning repo', { cleanUrl, branch, workDir });
      await netGit().clone(authUrl, workDir, [
        '-b', branch, '--depth', '1', '--single-branch', '--no-recurse-submodules',
      ]);

      // Immediately scrub token from .git/config remote origin
      await simpleGit(workDir).remote(['set-url', 'origin', cleanUrl]);

      const commitHash = await simpleGit(workDir).revparse(['HEAD']);
      return { workDir, commitHash: commitHash.trim() };
    }
  }
}

export const gitService = new GitService();
