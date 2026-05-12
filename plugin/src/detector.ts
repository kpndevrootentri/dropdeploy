import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const run = promisify(exec);

export interface GitInfo {
  remoteUrl: string | null;
  branch: string;
  isDirty: boolean;
  unpushedCommits: boolean;
}

export async function getGitInfo(cwd: string): Promise<GitInfo> {
  const git = (cmd: string) =>
    run(cmd, { cwd })
      .then(({ stdout }) => stdout.trim())
      .catch(() => null);

  const [remoteUrl, branch, dirty, unpushed] = await Promise.all([
    git('git remote get-url origin'),
    git('git rev-parse --abbrev-ref HEAD'),
    git('git status --porcelain'),
    git('git log @{u}..HEAD --oneline'),
  ]);

  return {
    remoteUrl: remoteUrl || null,
    branch: branch || 'main',
    isDirty: (dirty ?? '').length > 0,
    // null means the command failed (no upstream tracking branch) — treat as unknown, not "has unpushed commits"
    unpushedCommits: unpushed !== null && unpushed.length > 0,
  };
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export async function validateLocal(
  cwd: string,
  info: GitInfo,
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!info.remoteUrl) {
    errors.push(
      'No git remote "origin" found. Push your repo to GitHub or GitLab first.',
    );
  }

  if (info.unpushedCommits) {
    warnings.push(
      'You have unpushed commits. DropDeploy deploys from the remote — push first to include latest changes.',
    );
  }

  // For JS projects, check that a build script exists
  try {
    const raw = await readFile(join(cwd, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
    if (!pkg.scripts?.build) {
      errors.push('No "build" script found in package.json.');
    }
  } catch {
    // Not a JS project — skip
  }

  return { ok: errors.length === 0, errors, warnings };
}
