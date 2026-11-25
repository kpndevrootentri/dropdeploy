import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import type { EntrifyApi, Project } from './api.js';
import { CliError, EXIT, cliName } from './util.js';

// The server's upload rules (src/upload route, src/services/upload/upload.service.ts, project.validator.ts); keep in sync.
const MAX_BYTES = 50 * 1024 * 1024;
const MAX_FILES = 500;
const SITE_NAME = /^[a-zA-Z0-9 _-]{3,50}$/;
const NOT_SITE_NAME_CHARS = /[^a-zA-Z0-9 _-]/g; // for .replace() only: a /g regex keeps lastIndex between .test() calls
const SITE_NAME_MAX = 50;
// The server publishes only these types and drops any other file without saying so.
const PUBLISHED_TYPES = [
  '.html', '.htm', '.css', '.js', '.mjs', '.cjs', '.json', '.svg', '.ico', '.png', '.jpg', '.jpeg',
  '.gif', '.webp', '.avif', '.woff', '.woff2', '.ttf', '.eot', '.xml', '.txt', '.map', '.webmanifest',
];
const isPublished = (file: string) => PUBLISHED_TYPES.includes(extname(file).toLowerCase());

export interface UploadBundle {
  bytes: Uint8Array;
  /** Ends in .html or .zip: the server picks how to unpack the file by its name. */
  filename: string;
  /** Relative paths that will be published, sorted. */
  files: string[];
  /** Files of a type the server does not publish: left out of a folder, dropped by the server from a .zip. */
  skipped: string[];
}

export interface UploadOutcome {
  url: string | null;
  project: SiteRef | null;
  created: boolean;
  dryRun: boolean;
  files: string[];
  skipped: string[];
}

type SiteRef = Pick<Project, 'id' | 'slug' | 'name'>;
const publicProject = ({ id, slug, name }: SiteRef): SiteRef => ({ id, slug, name });

function checkSize(bytes: number): void {
  if (bytes > MAX_BYTES) {
    throw new CliError(`The upload is ${(bytes / 1024 / 1024).toFixed(1)} MB; Entrify accepts up to 50 MB.`, 'TOO_LARGE', EXIT.NEEDS_INPUT);
  }
}

function checkCount(count: number): void {
  if (count > MAX_FILES) {
    throw new CliError(`The upload has ${count} files; Entrify accepts up to ${MAX_FILES}.`, 'TOO_MANY_FILES', EXIT.NEEDS_INPUT);
  }
}

/** Every file under `root`, as forward-slash paths. Skips dotfiles, node_modules and symlinks, so nothing outside `root` or secret is sent. */
async function walk(root: string, rel = ''): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(join(root, rel), { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await walk(root, path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

/**
 * An .html file, a .zip, or a folder with index.html at its root, ready to upload.
 * `bundlePath('site')` (index.html, style.css, .env, notes.pdf) → `{ filename: 'site.zip', files: ['index.html', 'style.css'], skipped: ['notes.pdf'] }`
 */
export async function bundlePath(path: string): Promise<UploadBundle> {
  // Only a missing path is "does not exist"; any other error (e.g. EACCES) keeps its own message.
  const info = await stat(path).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') return null;
    throw err;
  });
  if (!info) throw new CliError(`${path} does not exist.`, 'INVALID_PATH', EXIT.NEEDS_INPUT);

  if (info.isDirectory()) {
    // Checked before the walk, so pointing at a big folder by mistake fails fast. Matched by exact name:
    // on macOS/Windows a lookup of index.html also finds Index.html, which the Linux server refuses.
    const top = await readdir(path, { withFileTypes: true });
    const hasFile = (name: string) => top.some((entry) => entry.name === name && entry.isFile());
    // A source folder (Vite keeps index.html at its root) would publish package.json and config files, not a working site.
    if (hasFile('package.json')) {
      throw new CliError(
        `${path} looks like a project's source (it has package.json). Build it and upload the output folder (for example ${join(path, 'dist')}), or deploy the repository with ${cliName()} deploy.`,
        'PROJECT_SOURCE',
        EXIT.NEEDS_INPUT,
      );
    }
    if (!hasFile('index.html')) {
      throw new CliError(`${path} has no index.html at its top level.`, 'NO_INDEX_HTML', EXIT.NEEDS_INPUT);
    }
    const all = (await walk(path)).sort();
    const files = all.filter(isPublished);
    checkCount(files.length);
    // ponytail: reads the whole folder into memory before the 50 MB check; stream it if folders of large media become common.
    const zippable: Zippable = {};
    for (const f of files) zippable[f] = await readFile(join(path, f));
    const bytes = zipSync(zippable);
    checkSize(bytes.length);
    return { bytes, filename: 'site.zip', files, skipped: all.filter((f) => !isPublished(f)) };
  }

  const ext = extname(path).toLowerCase();
  if (!info.isFile() || !['.html', '.htm', '.zip'].includes(ext)) {
    throw new CliError(`${path} is not an .html file, a .zip file or a folder.`, 'INVALID_PATH', EXIT.NEEDS_INPUT);
  }
  checkSize(info.size);
  const bytes = await readFile(path);
  const name = basename(path);
  // The server matches the extension case-sensitively, so PAGE.HTML would be refused.
  const filename = basename(path, extname(path)) + (ext === '.zip' ? '.zip' : '.html');
  if (ext !== '.zip') return { bytes, filename, files: [name], skipped: [] };

  const entries: string[] = [];
  try {
    // Lists the entries without decompressing them.
    unzipSync(bytes, {
      filter: (f) => {
        if (!f.name.endsWith('/')) entries.push(f.name);
        return false;
      },
    });
  } catch {
    throw new CliError(`${path} is not a valid zip file.`, 'INVALID_PATH', EXIT.NEEDS_INPUT);
  }
  checkCount(entries.length); // the server counts every entry, published or not
  entries.sort();
  return { bytes, filename, files: entries.filter(isPublished), skipped: entries.filter((f) => !isPublished(f)) };
}

/**
 * A page written in memory (e.g. by Claude), with optional extra text files such as `css/style.css`.
 * `bundleHtml('<h1>Hi</h1>', { 'style.css': 'h1{}' })` → `{ filename: 'site.zip', files: ['index.html', 'style.css'], skipped: [] }`
 */
export function bundleHtml(html: string, files?: Record<string, string>): UploadBundle {
  if (typeof html !== 'string' || !html) throw new CliError('The page HTML is empty.', 'INVALID_INPUT', EXIT.NEEDS_INPUT);
  const extra = Object.entries(files ?? {});
  if (extra.length === 0) {
    const bytes = strToU8(html);
    checkSize(bytes.length);
    return { bytes, filename: 'index.html', files: ['index.html'], skipped: [] };
  }

  checkCount(extra.length + 1);
  const zippable: Zippable = { 'index.html': strToU8(html) };
  for (const [key, value] of extra) {
    // __proto__ would replace the prototype of the plain objects fflate builds instead of adding a file.
    if (key === 'index.html' || key === '__proto__' || key.includes('\\') || key.split('/').some((s) => s === '' || s === '.' || s === '..')) {
      throw new CliError(`Invalid file name "${key}": use a relative path such as css/style.css, and put the page itself in html.`, 'INVALID_INPUT', EXIT.NEEDS_INPUT);
    }
    if (typeof value !== 'string') throw new CliError(`File "${key}" must be text.`, 'INVALID_INPUT', EXIT.NEEDS_INPUT);
    if (!isPublished(key)) {
      throw new CliError(`File "${key}" would not be published: Entrify serves only ${PUBLISHED_TYPES.join(' ')} files.`, 'INVALID_INPUT', EXIT.NEEDS_INPUT);
    }
    zippable[key] = strToU8(value);
  }
  const bytes = zipSync(zippable);
  checkSize(bytes.length);
  return { bytes, filename: 'site.zip', files: ['index.html', ...extra.map(([key]) => key)].sort(), skipped: [] };
}

/** A site name from a path: `pages/My Page (1).html` → `My Page -1`, `site/index.html` → `site`. */
export function defaultSiteName(path: string): string {
  const abs = resolve(path);
  const ext = extname(abs);
  let raw = /^\.(html?|zip)$/i.test(ext) ? basename(abs, ext) : basename(abs);
  if (raw.toLowerCase() === 'index') raw = basename(dirname(abs));
  const name = raw
    .replace(NOT_SITE_NAME_CHARS, '-')
    .replace(/-+/g, '-')
    .slice(0, SITE_NAME_MAX)
    .replace(/^[- ]+|[- ]+$/g, '');
  if (!SITE_NAME.test(name)) throw new CliError(`Could not make a site name from "${path}". Pass --name.`, 'INVALID_NAME', EXIT.NEEDS_INPUT);
  return name;
}

/**
 * Uploads `bundle` as a new site called `name`, or as a new version of `projectId` (id or slug).
 * Never replaces a site unless `projectId` names it: a taken name is a NAME_TAKEN error.
 * `deploySite(api, bundle, { name: 'My Page' })` → `{ url: 'https://my-page.entrify.site', created: true, ... }`
 */
export async function deploySite(
  api: EntrifyApi,
  bundle: UploadBundle,
  opts: { name: string; projectId?: string; dryRun?: boolean },
): Promise<UploadOutcome> {
  // Checked here so a bad name fails before a dry run passes or a 50 MB upload is sent.
  if (!opts.projectId && !SITE_NAME.test(opts.name)) {
    throw new CliError(`Invalid site name "${opts.name}": use 3 to 50 letters, numbers, spaces, - or _.`, 'INVALID_NAME', EXIT.NEEDS_INPUT);
  }
  const { projects, quota } = await api.listProjectsWithQuota();
  let existing: Project | undefined;
  if (opts.projectId) {
    existing = projects.find((p) => p.id === opts.projectId || p.slug === opts.projectId);
    if (!existing) throw new CliError(`No site with id or slug "${opts.projectId}" in your projects.`, 'PROJECT_NOT_FOUND', EXIT.NEEDS_INPUT);
    if (existing.source !== 'UPLOAD') {
      throw new CliError(`"${existing.slug}" is deployed from git, so files cannot be uploaded to it.`, 'NOT_UPLOAD_PROJECT', EXIT.NEEDS_INPUT);
    }
  } else {
    const wanted = opts.name.trim().toLowerCase();
    const taken = projects.find((p) => p.name.trim().toLowerCase() === wanted);
    if (taken) {
      const message = taken.source === 'UPLOAD'
        ? `A site named "${opts.name}" already exists (${taken.slug}). Pass --project-id ${taken.slug} to upload a new version to it, or choose another --name.`
        : `A site named "${opts.name}" already exists (${taken.slug}) and is deployed from git. Choose another --name.`;
      throw new CliError(message, 'NAME_TAKEN', EXIT.NEEDS_INPUT, { project: publicProject(taken) });
    }
  }

  const created = !existing;
  // The server reads the whole upload before it checks the limit, so check it here.
  if (created && quota && quota.available <= 0) {
    throw new CliError(
      `You have used all ${quota.limit} of your projects. Delete one (list them with ${cliName()} projects) or ask an admin for a higher limit.`,
      'QUOTA_EXCEEDED',
      EXIT.NEEDS_INPUT,
    );
  }
  const { files, skipped } = bundle;
  if (opts.dryRun) {
    return { url: null, project: existing ? publicProject(existing) : null, created, dryRun: true, files, skipped };
  }
  const result = await api.upload(bundle.bytes, bundle.filename, existing ? { projectId: existing.id } : { name: opts.name }).catch((err: unknown) => {
    // The server may finish after we stop waiting; a blind retry would then stop with NAME_TAKEN.
    if (created && err instanceof CliError && err.code === 'TIMEOUT') {
      throw new CliError(`${err.message}. The site may have been created anyway: check with ${cliName()} projects before uploading again.`, 'TIMEOUT');
    }
    throw err;
  });
  return { url: result.url, project: publicProject(result.project), created, dryRun: false, files, skipped };
}
