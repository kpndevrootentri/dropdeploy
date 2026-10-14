import * as fs from 'fs';
import * as path from 'path';
import { ValidationError } from './errors';

/**
 * File access inside a cloned user repository, from the host.
 *
 * The worker runs on the host with the platform's own privileges, and `git
 * clone` keeps symbolic links. A repo that commits `Dockerfile ->
 * /home/ubuntu/.ssh/authorized_keys` would otherwise have the worker write
 * through the link when it generates the Dockerfile — onto any host file the
 * service account can touch. A dangling link is just as bad: writing to it
 * creates the target. So every file the platform itself reads or writes in a
 * repo must be a regular file, or absent.
 */

async function assertNotSymlink(filePath: string): Promise<void> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.lstat(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  if (stat.isSymbolicLink()) {
    throw new ValidationError(
      `${path.basename(filePath)} in the repository is a symbolic link. Replace it with a regular file.`,
    );
  }
}

/** Whether a regular (non-symlink) file exists at `filePath`. Throws on a symlink. */
export async function repoFileExists(filePath: string): Promise<boolean> {
  await assertNotSymlink(filePath);
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Reads a repo file, refusing symlinks. Returns null when it does not exist. */
export async function readRepoFile(filePath: string): Promise<string | null> {
  if (!(await repoFileExists(filePath))) return null;
  return fs.promises.readFile(filePath, 'utf8');
}

/** Writes a repo file, refusing symlinks. */
export async function writeRepoFile(filePath: string, content: string): Promise<void> {
  await assertNotSymlink(filePath);
  await fs.promises.writeFile(filePath, content, 'utf8');
}
