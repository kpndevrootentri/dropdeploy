import * as fs from 'fs';
import * as path from 'path';
import { getConfig } from '@/lib/config';
import type { DockerService } from '@/services/docker';

/**
 * Removes everything a project left on the host: container, image, served
 * static files and the git clone.
 *
 * The clone matters most. Slugs are reusable, and the git service reuses any
 * clone it finds under the slug, so a project created later with the same
 * name would otherwise inherit the previous owner's `.git` — their full,
 * possibly private, history and every untracked file.
 */
export async function removeProjectResources(slug: string, docker: DockerService): Promise<void> {
  await docker.stopAndRemoveContainer(`dropdeploy-${slug}`);
  const { STATIC_SERVE_DIR, PROJECTS_DIR } = getConfig();
  const rmDir = (dir: string): Promise<void> =>
    fs.promises.rm(path.join(dir, slug), { recursive: true, force: true }).catch(() => {});
  await Promise.all([
    rmDir(STATIC_SERVE_DIR),
    rmDir(PROJECTS_DIR),
    docker.removeImage(`dropdeploy/${slug}:latest`).then(() => docker.removeSupersededImages(slug)),
  ]);
}
