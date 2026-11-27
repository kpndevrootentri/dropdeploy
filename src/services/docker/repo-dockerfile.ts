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
 * next line as is (no space, its indent kept), blank and comment lines are
 * skipped, and the keyword ends at the first ASCII space or tab.
 */
function instructions(text: string): Array<[string, string]> {
  const CONTINUATION = /\\[ \t]*$/;
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
    instruction = (instruction ?? '') + part.replace(CONTINUATION, '');
    if (CONTINUATION.test(part)) continue;
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
 */
export function forbiddenInstruction(text: string): string | null {
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

/**
 * The images a Dockerfile builds FROM, leaving out scratch and earlier stages.
 * Each must be written out and pinned by digest, so the image checked for
 * ONBUILD triggers before the build is the one the build pulls; throws with
 * the rule otherwise. Neither FROM nor COPY --from may name the platform's own
 * images. Run forbiddenInstruction first: it refuses the non-ASCII keywords
 * this reads past.
 */
export function baseImages(text: string): string[] {
  const stages = new Set(['scratch']);
  const images: string[] = [];
  const own = (image: string) => {
    if (PLATFORM_IMAGE.test(image)) throw new Error(`Your Dockerfile uses the image ${image}: use a public image, not one of Entrify's own images.`);
  };
  for (const [keyword, rest] of instructions(text)) {
    if (keyword.toUpperCase() === 'COPY') {
      // Flags end at the first word without `--`. Docker unquotes and unescapes them, so neither is allowed.
      for (const word of rest.split(/[\t\n\v\f\r ]+/)) {
        if (!word.startsWith('--')) break;
        if (/[^\x21-\x7e]|["'\\]/.test(word)) throw new Error(`Your Dockerfile has "COPY ${rest}". Write COPY flags without quotes, backslashes or non-ASCII characters.`);
        const from = /^--from=(.*)$/i.exec(word)?.[1];
        if (from === undefined || stages.has(from.toLowerCase()) || /^\d+$/.test(from)) continue;
        if (from.includes('$')) throw new Error(`Your Dockerfile has "COPY --from=${from}". Name a stage or an image without variables.`);
        own(from);
      }
      continue;
    }
    if (keyword.toUpperCase() !== 'FROM') continue;
    const [, image, stage] = /^([\w./:@-]+)(?:[\t\v\f\r ]+as[\t\v\f\r ]+([\w.-]+))?$/i.exec(rest) ?? [];
    if (!image) {
      throw new Error(`Your Dockerfile has "FROM ${rest}". Write FROM <image>@sha256:<digest>, optionally followed by AS <name>, without variables or --platform.`);
    }
    if (!stages.has(image.toLowerCase())) {
      own(image);
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
