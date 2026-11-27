/**
 * Rules for a project an admin has switched to its repository's own Dockerfile.
 * The worker scans the file before the build; the container start reads the
 * image's label, so a rollback to such an image keeps these rules after the
 * admin switches the project back.
 */

/** Image label set at build time; 'repo' marks an image built from the repository's Dockerfile. */
export const REPO_DOCKERFILE_LABEL = 'dropdeploy.dockerfile';

/** The uid:gid a repo-built image always runs as, whatever its USER says (uid 0 included). */
export const REPO_IMAGE_USER = '10001:10001';

// ponytail: one cap for every project; make it an env var if admins need it per project.
export const REPO_IMAGE_MAX_BYTES = 2 * 1024 ** 3;

/**
 * The first refused instruction in a Dockerfile, or null. ADD and ONBUILD make
 * the daemon itself download URLs (ONBUILD can also hide an ADD for a later
 * build). A `# escape=` directive is refused too, so the line joining below
 * always matches how Docker reads the file: a trailing `\` joins the next line
 * as is (no space, its indent kept), and blank and comment lines are skipped.
 */
export function forbiddenInstruction(text: string): 'ADD' | 'ONBUILD' | '# escape=' | null {
  const CONTINUATION = /\\[ \t]*$/;
  const refused = (instruction: string) => {
    const keyword = instruction.split(/\s/)[0].toUpperCase();
    return keyword === 'ADD' || keyword === 'ONBUILD' ? keyword : null;
  };
  let instruction: string | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const stripped = line.trimStart();
    if (stripped === '' || stripped.startsWith('#')) {
      if (/^#\s*escape\s*=/i.test(stripped)) return '# escape=';
      continue;
    }
    const part: string = instruction === null ? stripped : line;
    instruction = (instruction ?? '') + part.replace(CONTINUATION, '');
    if (CONTINUATION.test(part)) continue;
    const hit = refused(instruction);
    if (hit) return hit;
    instruction = null;
  }
  // A continuation still open at the end of the file is an instruction too.
  return instruction === null ? null : refused(instruction);
}

/** The one TCP port the image EXPOSEs (its Config.ExposedPorts). Throws unless there is exactly one. */
export function exposedPort(exposedPorts: Record<string, unknown> | null | undefined): number {
  const tcp = Object.keys(exposedPorts ?? {}).filter((key) => key.endsWith('/tcp'));
  const port = tcp.length === 1 ? Number(/^(\d{1,5})\/tcp$/.exec(tcp[0])?.[1]) : NaN;
  if (!(port >= 1 && port <= 65535)) {
    throw new Error(
      `Your Dockerfile must EXPOSE exactly one TCP port (for example EXPOSE 3000); it exposes ${tcp.length > 0 ? tcp.join(', ') : 'none'}.`,
    );
  }
  return port;
}
