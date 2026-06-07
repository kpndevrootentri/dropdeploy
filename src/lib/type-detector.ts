import * as fs from 'fs';
import * as path from 'path';
import type { ProjectType } from '@/types/project.types';

export interface DetectionResult {
  type: ProjectType;
  confidence: 'high' | 'medium' | 'low';
  hint: string;
  hasStaticExport?: boolean;
}

function isNextjsStaticExport(content: string): boolean {
  return /output\s*:\s*['"]export['"]/.test(content);
}

// ---------------------------------------------------------------------------
// File-based detection — reads a local checkout directory
// ---------------------------------------------------------------------------

export async function detectFromFiles(workDir: string): Promise<DetectionResult> {
  const has = (file: string) =>
    fs.promises.access(path.join(workDir, file)).then(() => true).catch(() => false);
  const read = (file: string) =>
    fs.promises.readFile(path.join(workDir, file), 'utf8').catch(() => null);

  for (const f of ['next.config.js', 'next.config.ts', 'next.config.mjs', 'next.config.cjs']) {
    const content = await read(f);
    if (content !== null) {
      return { type: 'NEXTJS', confidence: 'high', hint: f, hasStaticExport: isNextjsStaticExport(content) };
    }
  }

  const pkgRaw = await read('package.json');
  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if ('next' in deps)   return { type: 'NEXTJS', confidence: 'high', hint: '"next" in package.json' };
      if ('vue' in deps)    return { type: 'VUE',    confidence: 'high', hint: '"vue" in package.json' };
      if ('svelte' in deps) return { type: 'SVELTE', confidence: 'high', hint: '"svelte" in package.json' };
      if ('react' in deps)  return { type: 'REACT',  confidence: 'high', hint: '"react" in package.json' };
      return { type: 'NODEJS', confidence: 'medium', hint: 'package.json present' };
    } catch {
      return { type: 'NODEJS', confidence: 'low', hint: 'package.json (parse error)' };
    }
  }

  if (await has('go.mod'))    return { type: 'GO',   confidence: 'high', hint: 'go.mod' };
  if (await has('Cargo.toml')) return { type: 'RUST', confidence: 'high', hint: 'Cargo.toml' };
  if (await has('pom.xml'))   return { type: 'JAVA', confidence: 'high', hint: 'pom.xml' };
  if (await has('build.gradle') || await has('build.gradle.kts')) {
    return { type: 'JAVA', confidence: 'high', hint: 'build.gradle' };
  }
  if (await has('manage.py')) return { type: 'DJANGO', confidence: 'high', hint: 'manage.py' };

  const reqs = await read('requirements.txt');
  if (reqs) {
    const l = reqs.toLowerCase();
    if (l.includes('fastapi')) return { type: 'FASTAPI', confidence: 'high',   hint: 'fastapi in requirements.txt' };
    if (l.includes('flask'))   return { type: 'FLASK',   confidence: 'high',   hint: 'flask in requirements.txt' };
    if (l.includes('django'))  return { type: 'DJANGO',  confidence: 'high',   hint: 'django in requirements.txt' };
  }

  const pyproject = await read('pyproject.toml');
  if (pyproject) {
    const l = pyproject.toLowerCase();
    if (l.includes('fastapi')) return { type: 'FASTAPI', confidence: 'medium', hint: 'fastapi in pyproject.toml' };
    if (l.includes('flask'))   return { type: 'FLASK',   confidence: 'medium', hint: 'flask in pyproject.toml' };
    if (l.includes('django'))  return { type: 'DJANGO',  confidence: 'medium', hint: 'django in pyproject.toml' };
  }

  if (await has('index.html')) return { type: 'STATIC', confidence: 'medium', hint: 'index.html' };

  return { type: 'STATIC', confidence: 'low', hint: 'no recognized indicators' };
}

// ---------------------------------------------------------------------------
// URL-based detection — fetches indicator files via raw HTTP (no clone)
// ---------------------------------------------------------------------------

function parseRepoUrl(repoUrl: string): { host: 'github' | 'gitlab'; owner: string; repo: string } | null {
  try {
    const url = new URL(repoUrl.replace(/\.git$/, ''));
    const parts = url.pathname.replace(/^\//, '').split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const repo = parts[parts.length - 1];
    const owner = parts.slice(0, -1).join('/');
    if (url.hostname === 'github.com') return { host: 'github', owner, repo };
    if (url.hostname === 'gitlab.com') return { host: 'gitlab', owner, repo };
    return null;
  } catch {
    return null;
  }
}

async function fetchRaw(url: string, headers: Record<string, string> = {}): Promise<string | null> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export async function detectFromRawUrl(
  repoUrl: string,
  branch: string,
  token?: string,
): Promise<DetectionResult> {
  const parsed = parseRepoUrl(repoUrl);
  if (!parsed) return { type: 'STATIC', confidence: 'low', hint: 'unrecognized repo URL' };

  const { host, owner, repo } = parsed;

  const makeUrl = (file: string): string => {
    if (host === 'github') {
      if (token) {
        return `https://api.github.com/repos/${owner}/${repo}/contents/${file}?ref=${branch}`;
      }
      return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${file}`;
    }
    // GitLab — prefer API (works for private repos with token)
    const project = encodeURIComponent(`${owner}/${repo}`);
    const filePath = encodeURIComponent(file);
    return `https://gitlab.com/api/v4/projects/${project}/repository/files/${filePath}/raw?ref=${branch}`;
  };

  const makeGitLabRawUrl = (file: string): string =>
    `https://gitlab.com/${owner}/${repo}/-/raw/${branch}/${file}`;

  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
    if (host === 'github') headers['Accept'] = 'application/vnd.github.raw+json';
  }

  const probe = async (file: string): Promise<string | null> => {
    const result = await fetchRaw(makeUrl(file), headers);
    // For public GitLab repos without a token, fall back to the raw URL
    if (result === null && host === 'gitlab' && !token) {
      return fetchRaw(makeGitLabRawUrl(file));
    }
    return result;
  };

  const [
    nextConfigJs, nextConfigTs, nextConfigMjs,
    packageJson,
    goMod,
    cargoToml,
    pomXml,
    buildGradle,
    managePy,
    requirementsTxt,
    indexHtml,
  ] = await Promise.all([
    probe('next.config.js'),
    probe('next.config.ts'),
    probe('next.config.mjs'),
    probe('package.json'),
    probe('go.mod'),
    probe('Cargo.toml'),
    probe('pom.xml'),
    probe('build.gradle'),
    probe('manage.py'),
    probe('requirements.txt'),
    probe('index.html'),
  ]);

  if (nextConfigJs) return { type: 'NEXTJS', confidence: 'high', hint: 'next.config.js', hasStaticExport: isNextjsStaticExport(nextConfigJs) };
  if (nextConfigTs) return { type: 'NEXTJS', confidence: 'high', hint: 'next.config.ts', hasStaticExport: isNextjsStaticExport(nextConfigTs) };
  if (nextConfigMjs) return { type: 'NEXTJS', confidence: 'high', hint: 'next.config.mjs', hasStaticExport: isNextjsStaticExport(nextConfigMjs) };

  if (packageJson) {
    try {
      const pkg = JSON.parse(packageJson) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if ('next' in deps)   return { type: 'NEXTJS', confidence: 'high', hint: '"next" in package.json' };
      if ('vue' in deps)    return { type: 'VUE',    confidence: 'high', hint: '"vue" in package.json' };
      if ('svelte' in deps) return { type: 'SVELTE', confidence: 'high', hint: '"svelte" in package.json' };
      if ('react' in deps)  return { type: 'REACT',  confidence: 'high', hint: '"react" in package.json' };
      return { type: 'NODEJS', confidence: 'medium', hint: 'package.json present' };
    } catch {
      return { type: 'NODEJS', confidence: 'low', hint: 'package.json (parse error)' };
    }
  }

  if (goMod)      return { type: 'GO',   confidence: 'high', hint: 'go.mod' };
  if (cargoToml)  return { type: 'RUST', confidence: 'high', hint: 'Cargo.toml' };
  if (pomXml)     return { type: 'JAVA', confidence: 'high', hint: 'pom.xml' };
  if (buildGradle) return { type: 'JAVA', confidence: 'high', hint: 'build.gradle' };
  if (managePy)   return { type: 'DJANGO', confidence: 'high', hint: 'manage.py' };

  if (requirementsTxt) {
    const l = requirementsTxt.toLowerCase();
    if (l.includes('fastapi')) return { type: 'FASTAPI', confidence: 'high', hint: 'fastapi in requirements.txt' };
    if (l.includes('flask'))   return { type: 'FLASK',   confidence: 'high', hint: 'flask in requirements.txt' };
    if (l.includes('django'))  return { type: 'DJANGO',  confidence: 'high', hint: 'django in requirements.txt' };
  }

  if (indexHtml) return { type: 'STATIC', confidence: 'medium', hint: 'index.html' };

  return { type: 'STATIC', confidence: 'low', hint: 'no recognized indicators' };
}
