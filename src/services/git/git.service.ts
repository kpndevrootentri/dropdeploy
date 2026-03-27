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
  ensureRepo(authUrl: string, cleanUrl: string, projectSlug: string, branch: string): Promise<RepoResult>;
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
  ): Promise<RepoResult> {
    const workDir = this.getWorkDir(projectSlug);
    await fs.promises.mkdir(getConfig().PROJECTS_DIR, { recursive: true });

    const gitDir = path.join(workDir, '.git');
    const exists = await fs.promises
      .stat(gitDir)
      .then(() => true)
      .catch(() => false);

    if (exists) {
      // Repo already cloned – update remote URL (may need new token) then fetch+reset
      log.info('Pulling latest', { slug: projectSlug, branch });
      const git = simpleGit(workDir);

      // Update remote to use authUrl for this fetch (token may have rotated)
      await git.remote(['set-url', 'origin', authUrl]);

      await git.raw([
        'config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*',
      ]);

      const isShallow = await fs.promises
        .stat(path.join(gitDir, 'shallow'))
        .then(() => true)
        .catch(() => false);
      if (isShallow) {
        await git.fetch(['origin', '--unshallow', '--prune']);
      } else {
        await git.fetch(['origin', '--prune']);
      }

      // Scrub token from remote URL immediately after fetch
      await git.remote(['set-url', 'origin', cleanUrl]);

      try {
        await git.checkout(branch);
      } catch {
        await git.checkoutBranch(branch, `origin/${branch}`);
      }
      await git.reset(['--hard', `origin/${branch}`]);

      const commitHash = await git.revparse(['HEAD']);
      return { workDir, commitHash: commitHash.trim() };
    } else {
      // First deploy – full clone
      log.info('Cloning repo', { cleanUrl, branch, workDir });
      const git = simpleGit();
      await git.clone(authUrl, workDir, ['-b', branch]);

      // Immediately scrub token from .git/config remote origin
      await simpleGit(workDir).remote(['set-url', 'origin', cleanUrl]);

      const commitHash = await simpleGit(workDir).revparse(['HEAD']);
      return { workDir, commitHash: commitHash.trim() };
    }
  }
}

export const gitService = new GitService();
