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

// Go's unicode.IsSpace, which Docker's parser trims lines with: JavaScript's \s
// without U+FEFF, plus U+0085.
const SPACE = '\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const LEADING_SPACE = new RegExp(`^[${SPACE}]+`);
const OUTER_SPACE = new RegExp(`^[${SPACE}]+|[${SPACE}]+$`, 'g');
// Wider than Docker's own check (any line, more spaces), so it never misses one.
const ESCAPE_DIRECTIVE = new RegExp(`^[${SPACE}\\uFEFF]*#\\s*escape\\s*=`, 'im');

/**
 * A Dockerfile's instructions as [keyword, arguments], read the way Docker's
 * parser reads them: a BOM at the start is dropped, a trailing `\` joins the
 * next line as is (no space, its indent kept) unless another `\` comes right
 * before it, blank and comment lines are skipped, and the keyword ends at the
 * first ASCII space or tab.
 */
function instructions(text: string): Array<[string, string]> {
  // Docker's lineContinuationRegex: `a\\` ends the instruction, `a\` and a lone `\` continue it.
  const CONTINUATION = /(?:^|[^\\])\\[ \t]*$/;
  const found: Array<[string, string]> = [];
  const add = (instruction: string) => {
    const [, keyword, rest] = /^([^\t\v\f\r ]*)[\t\v\f\r ]*([\s\S]*)$/.exec(instruction.replace(OUTER_SPACE, ''))!;
    found.push([keyword, rest]);
  };
  let instruction: string | null = null;
  for (const raw of text.replace(/^\uFEFF/, '').split('\n')) {
    const line = raw.replace(/\r+$/, '');
    const stripped = line.replace(LEADING_SPACE, '');
    if (stripped === '' || stripped.startsWith('#')) continue;
    const part: string = instruction === null ? stripped : line;
    const continues = CONTINUATION.test(part);
    instruction = (instruction ?? '') + (continues ? part.replace(/\\[ \t]*$/, '') : part);
    if (continues) continue;
    add(instruction);
    instruction = null;
  }
  // A continuation still open at the end of the file is an instruction too.
  if (instruction !== null) add(instruction);
  return found;
}

/**
 * The first refused instruction in a Dockerfile, or null. ADD and ONBUILD make
 * the daemon itself download URLs (ONBUILD can also hide an ADD for a later
 * build). A `# escape=` directive and heredocs (`<<` in RUN or COPY, whose
 * body lines Docker does not read as instructions) are refused so the line
 * joining above always holds, and a keyword with a non-ASCII character because
 * Docker lowercases it with Go's rules (to Docker, ONBU\u0130LD is ONBUILD).
 * Invalid UTF-8 (read here as U+FFFD) is refused because Docker reads some
 * stray bytes as spaces.
 */
export function forbiddenInstruction(text: string): string | null {
  if (text.includes('\uFFFD')) return 'invalid UTF-8';
  if (ESCAPE_DIRECTIVE.test(text)) return '# escape=';
  for (const [keyword, rest] of instructions(text)) {
    if (/[^\x21-\x7e]/.test(keyword)) return keyword;
    const upper = keyword.toUpperCase();
    if (upper === 'ADD' || upper === 'ONBUILD') return upper;
    if ((upper === 'RUN' || upper === 'COPY') && rest.includes('<<')) return `${upper} <<`;
  }
  return null;
}

// docker.io/dropdeploy/<slug>: a pull of one of these names would re-tag a project's local image.
const PLATFORM_IMAGE = /^(?:(?:index\.)?docker\.io\/)?dropdeploy\//i;

/** The registries a repo Dockerfile's images may come from: public ones whose token servers are their own. */
const ALLOWED_REGISTRIES = ['docker.io', 'ghcr.io', 'quay.io', 'public.ecr.aws', 'mcr.microsoft.com', 'registry.gitlab.com'];
const REGISTRY_HOSTS = new Set([...ALLOWED_REGISTRIES, 'index.docker.io', 'registry-1.docker.io']);

/**
 * Throws unless the daemon would pull the image from one of ALLOWED_REGISTRIES,
 * and for the platform's own images. The registry is found the way Docker's
 * reference parser finds it: the part before the first `/` when it has a `.`
 * or `:`, is `localhost` or is not all lowercase; Docker Hub otherwise. It must
 * match exactly, so localhost, IP addresses, ports, uppercase hosts and a
 * trailing dot are all refused.
 */
export function checkImage(image: string): void {
  if (PLATFORM_IMAGE.test(image)) throw new Error(`Your Dockerfile uses the image ${image}: use a public image, not one of Entrify's own images.`);
  const first = image.split('/')[0];
  const hub = first === image || (!/[.:]/.test(first) && first !== 'localhost' && first === first.toLowerCase());
  if (!hub && !REGISTRY_HOSTS.has(first)) {
    throw new Error(`Your Dockerfile uses the image ${image}. Images must come from ${ALLOWED_REGISTRIES.join(', ')}, with the registry written in lowercase as shown; localhost, IP addresses and hosts with a port are refused.`);
  }
}

/**
 * The images a Dockerfile builds FROM, leaving out scratch and earlier stages.
 * Each must be written out and pinned by digest, so the image checked for
 * ONBUILD triggers before the build is the one the build pulls; throws with
 * the rule otherwise. Every FROM and COPY --from image must pass checkImage.
 * Run forbiddenInstruction first: it refuses the non-ASCII keywords and
 * invalid UTF-8 this reads past.
 */
export function baseImages(text: string): string[] {
  const stages = new Set(['scratch']);
  const images: string[] = [];
  for (const [keyword, rest] of instructions(text)) {
    if (keyword.toUpperCase() === 'COPY') {
      // Flags end at the first word without `--`. Docker unquotes and unescapes them, so neither is allowed.
      for (const word of rest.split(/[\t\n\v\f\r ]+/)) {
        if (!word.startsWith('--')) break;
        if (/[^\x21-\x7e]|["'\\]/.test(word)) throw new Error(`Your Dockerfile has "COPY ${rest}". Write COPY flags without quotes, backslashes or non-ASCII characters.`);
        const from = /^--from=(.*)$/i.exec(word)?.[1];
        if (from === undefined || stages.has(from.toLowerCase()) || /^\d+$/.test(from)) continue;
        if (from.includes('$')) throw new Error(`Your Dockerfile has "COPY --from=${from}". Name a stage or an image without variables.`);
        checkImage(from);
      }
      continue;
    }
    if (keyword.toUpperCase() !== 'FROM') continue;
    const [, image, stage] = /^([\w./:@-]+)(?:[\t\v\f\r ]+as[\t\v\f\r ]+([\w.-]+))?$/i.exec(rest) ?? [];
    if (!image) {
      throw new Error(`Your Dockerfile has "FROM ${rest}". Write FROM <image>@sha256:<digest>, optionally followed by AS <name>, without variables or --platform.`);
    }
    if (!stages.has(image.toLowerCase())) {
      checkImage(image);
      if (!/@sha256:[a-f0-9]{64}$/.test(image)) {
        throw new Error(`Pin each base image by digest: write FROM ${image}@sha256:<digest> (docker pull ${image} prints the digest).`);
      }
      images.push(image);
    }
    if (stage) stages.add(stage.toLowerCase());
  }
  return images;
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
