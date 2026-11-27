import * as fs from 'fs';
import * as path from 'path';
import type { Readable } from 'stream';
import dockerignore from '@balena/dockerignore';
import { pack } from 'tar-fs';
import { readRepoFile } from '@/lib/repo-fs';

/**
 * Packs the build context as a tar stream, leaving out what `.dockerignore`
 * excludes, the way `docker build` does. dockerode's own packing hands the
 * ignore check absolute paths, so no pattern ever matched.
 */
export async function packBuildContext(contextPath: string): Promise<Readable> {
  const rules = (await readRepoFile(path.join(contextPath, '.dockerignore'))) ?? '';
  const ig = dockerignore({ ignorecase: false }).add(rules);
  const exceptions = rules
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('!'))
    .map((line) => path.posix.normalize(line.slice(1).trim()).replace(/^\//, '') + '/');

  return pack(contextPath, {
    ignore: (absPath) => {
      const rel = path.relative(contextPath, absPath);
      // Docker never excludes these two.
      if (rel === 'Dockerfile' || rel === '.dockerignore' || !ig.ignores(rel)) return false;
      // Like Docker, walk into an excluded directory a `!` rule reaches into (`*` then `!src/**`).
      return !exceptions.some((e) => e.startsWith(rel + '/')) || !fs.lstatSync(absPath).isDirectory();
    },
  });
}
