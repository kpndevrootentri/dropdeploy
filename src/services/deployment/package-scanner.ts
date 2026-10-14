import * as path from 'path';
import { BUILT_IN_BLOCKED_PACKAGES, VERSION_SPECIFIC_COMPROMISES } from '@/lib/blocked-packages';
import { createLogger } from '@/lib/logger';
import { readRepoFile } from '@/lib/repo-fs';

const log = createLogger('package-scanner');

export interface PackageScanResult {
  blocked: string[];
}

/**
 * PEP 503 normalization: lowercase and collapse runs of [-_.] to a single dash.
 * Applies to both npm and pip names so comparisons are always canonical.
 * e.g. "typing_extensions" == "typing-extensions" == "Typing.Extensions"
 */
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

function parseBlocklist(raw: string): Set<string> {
  return new Set(
    raw
      .split(',')
      .map((p) => normalizeName(p.trim()))
      .filter(Boolean),
  );
}

/**
 * The package an npm alias actually installs: `"x": "npm:event-stream@3.3.6"`
 * installs `event-stream` under the name `x`, so checking only the key would
 * let any blocked package through under an innocent name.
 */
function npmAliasTarget(spec: unknown): string | null {
  if (typeof spec !== 'string' || !spec.startsWith('npm:')) return null;
  const target = spec.slice(4);
  // Scoped names start with '@'; the version separator is the *next* '@'.
  const at = target.indexOf('@', target.startsWith('@') ? 1 : 0);
  return (at === -1 ? target : target.slice(0, at)) || null;
}

function extractNpmPackages(packageJson: Record<string, unknown>): string[] {
  const depFields = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
  const packages: string[] = [];
  for (const field of depFields) {
    const deps = packageJson[field];
    if (deps && typeof deps === 'object') {
      for (const [name, spec] of Object.entries(deps as Record<string, unknown>)) {
        packages.push(name);
        const target = npmAliasTarget(spec);
        if (target) packages.push(target);
      }
    }
  }
  return packages;
}

/**
 * Every package a package-lock.json resolves — transitive dependencies
 * included, which the manifest alone never shows. The templates install with
 * npm, so this is what actually lands in the image. Lockfile v2/v3 list
 * `packages` keyed by install path (`node_modules/a/node_modules/b`), with a
 * `name` field when an alias installed something else there; v1 nests
 * `dependencies`.
 */
function extractNpmLockPackages(lock: Record<string, unknown>): string[] {
  const names = new Set<string>();
  const packages = lock.packages;
  if (packages && typeof packages === 'object') {
    for (const [key, meta] of Object.entries(packages as Record<string, { name?: unknown }>)) {
      const i = key.lastIndexOf('node_modules/');
      if (i !== -1) names.add(key.slice(i + 'node_modules/'.length));
      if (key && typeof meta?.name === 'string') names.add(meta.name);
    }
  }
  const walkV1 = (deps: unknown): void => {
    if (!deps || typeof deps !== 'object') return;
    for (const [name, meta] of Object.entries(deps as Record<string, { dependencies?: unknown }>)) {
      names.add(name);
      walkV1(meta?.dependencies);
    }
  };
  walkV1(lock.dependencies);
  return [...names];
}

function extractRequirementsTxtPackages(content: string): string[] {
  log.debug('Extracting requirements.txt packages')
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('-'))
    // `pkg @ https://…` (PEP 508 direct reference) splits on '@' / whitespace.
    .map((line) => line.split(/[><=!~\[;@\s]/)[0].trim().toLowerCase())
    .filter(Boolean);
}

/** `-r other.txt` / `--requirement other.txt` includes in a requirements file. */
function extractRequirementIncludes(content: string): string[] {
  const includes: string[] = [];
  for (const line of content.split('\n')) {
    const m = line.trim().match(/^(?:-r|--requirement)(?:\s+|=)(\S+)/);
    if (m) includes.push(m[1]);
  }
  return includes;
}

/** Most `-r` hops followed, so a include cycle or chain cannot run forever. */
const MAX_REQUIREMENT_INCLUDES = 10;

/**
 * Reads requirements.txt and every file it pulls in with `-r`, staying inside
 * the repo. A blocked package moved into `requirements/base.txt` is still installed.
 */
async function readRequirementsTree(workDir: string): Promise<string> {
  const root = path.resolve(workDir);
  const seen = new Set<string>();
  const queue = [path.join(root, 'requirements.txt')];
  const contents: string[] = [];
  while (queue.length > 0 && seen.size < MAX_REQUIREMENT_INCLUDES) {
    const file = path.resolve(queue.shift()!);
    if (seen.has(file) || !file.startsWith(root + path.sep)) continue;
    seen.add(file);
    const content = await readRepoFile(file).catch(() => null);
    if (content === null) continue;
    contents.push(content);
    for (const inc of extractRequirementIncludes(content)) {
      queue.push(path.join(path.dirname(file), inc));
    }
  }
  return contents.join('\n');
}

function extractPyprojectPackages(content: string): string[] {
  const packages: string[] = [];

  // PEP 621: [project] dependencies = ["pkg>=1.0", ...]
  const projectDepsMatch = content.match(/\[project\][^[]*?dependencies\s*=\s*\[([\s\S]*?)\]/);
  if (projectDepsMatch) {
    for (const match of projectDepsMatch[1].matchAll(/"([^"]+)"|'([^']+)'/g)) {
      const pkg = (match[1] ?? match[2]).split(/[><=!~\[;@]/)[0].trim().toLowerCase();
      if (pkg) packages.push(pkg);
    }
  }

  // Poetry: [tool.poetry.dependencies] section
  const poetryMatch = content.match(/\[tool\.poetry\.dependencies\]([\s\S]*?)(?=\[|$)/);
  if (poetryMatch) {
    for (const line of poetryMatch[1].split('\n')) {
      const nameMatch = line.match(/^([a-zA-Z0-9_-]+)\s*=/);
      if (nameMatch && nameMatch[1].toLowerCase() !== 'python') {
        packages.push(nameMatch[1].toLowerCase());
      }
    }
  }

  return packages;
}

/**
 * Scans package manifests in workDir against the built-in blocklist plus any
 * operator-supplied packages (comma-separated string from BLOCKED_PACKAGES env var).
 * Checks package.json (all dep fields and npm alias targets), package-lock.json
 * (transitive dependencies), requirements.txt with its `-r` includes, and
 * pyproject.toml. Returns the list of blocked package names found.
 *
 * A known-bad-name filter, not a sandbox: git, tarball and URL dependencies
 * carry no name to check, and a package can turn malicious in a version this
 * list has never seen. Build isolation (resource limits, no metadata-service
 * access, unprivileged containers) is what contains a malicious install.
 */
export async function scanPackages(
  workDir: string,
  extraBlocklist = '',
  allowlist = '',
): Promise<PackageScanResult> {
  log.debug('Scanning packages', { workDir })
  // Merge built-in list with operator additions — normalize all entries
  const blocklistSet = new Set(
    Array.from(BUILT_IN_BLOCKED_PACKAGES).map(normalizeName),
  );
  for (const pkg of parseBlocklist(extraBlocklist)) {
    blocklistSet.add(pkg);
  }
  // The operator's allowlist wins over both lists.
  for (const pkg of parseBlocklist(allowlist)) {
    blocklistSet.delete(pkg);
  }
  const blocked = new Set<string>();

  // --- package.json, plus package-lock.json for transitive dependencies ---
  try {
    const raw = await readRepoFile(path.join(workDir, 'package.json'));
    const parsed = JSON.parse(raw ?? '') as Record<string, unknown>;
    const npmPackages = extractNpmPackages(parsed);
    log.debug('Scanned package.json', { count: npmPackages.length });
    for (const pkg of npmPackages) {
      if (blocklistSet.has(normalizeName(pkg))) {
        blocked.add(pkg);
      }
    }
  } catch {
    // File absent or unparseable — skip
  }

  try {
    const raw = await readRepoFile(path.join(workDir, 'package-lock.json'));
    const lockPackages = extractNpmLockPackages(JSON.parse(raw ?? '') as Record<string, unknown>);
    log.debug('Scanned package-lock.json', { count: lockPackages.length });
    for (const pkg of lockPackages) {
      if (blocklistSet.has(normalizeName(pkg)) && !VERSION_SPECIFIC_COMPROMISES.has(normalizeName(pkg))) {
        blocked.add(pkg);
      }
    }
  } catch {
    // No lockfile or unparseable — the manifest scan above still applies
  }

  // --- requirements.txt (and its -r includes) ---
  try {
    const raw = await readRequirementsTree(workDir);
    const reqPackages = extractRequirementsTxtPackages(raw);
    log.debug('Scanned requirements.txt', { count: reqPackages.length });
    for (const pkg of reqPackages) {
      if (blocklistSet.has(normalizeName(pkg))) {
        blocked.add(pkg);
      }
    }
  } catch {
    // File absent — skip
  }

  // --- pyproject.toml ---
  try {
    const raw = await readRepoFile(path.join(workDir, 'pyproject.toml'));
    const pyprojectPackages = extractPyprojectPackages(raw ?? '');
    log.debug('Scanned pyproject.toml', { count: pyprojectPackages.length });
    for (const pkg of pyprojectPackages) {
      if (blocklistSet.has(normalizeName(pkg))) {
        blocked.add(pkg);
      }
    }
  } catch {
    // File absent — skip
  }

  const blockedList = Array.from(blocked);
  if (blockedList.length > 0) {
    log.warn('Blocked packages detected', { packages: blockedList });
  }
  return { blocked: blockedList };
}
