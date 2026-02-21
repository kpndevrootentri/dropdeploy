import * as fs from 'fs';
import * as path from 'path';
import { BUILT_IN_BLOCKED_PACKAGES } from '@/lib/blocked-packages';

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

function extractNpmPackages(packageJson: Record<string, unknown>): string[] {
  const depFields = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
  const packages: string[] = [];
  for (const field of depFields) {
    const deps = packageJson[field];
    if (deps && typeof deps === 'object') {
      packages.push(...Object.keys(deps as Record<string, string>));
    }
  }
  return packages;
}

function extractRequirementsTxtPackages(content: string): string[] {
  console.log("Extracting requirements.txt packages")
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('-'))
    .map((line) => line.split(/[><=!~\[;]/)[0].trim().toLowerCase())
    .filter(Boolean);
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
 * Checks package.json (all dep fields), requirements.txt, and pyproject.toml.
 * Returns the list of blocked package names found.
 */
export async function scanPackages(workDir: string, extraBlocklist = ''): Promise<PackageScanResult> {

  console.log("Scanning packages")
  // Merge built-in list with operator additions — normalize all entries
  const blocklistSet = new Set(
    Array.from(BUILT_IN_BLOCKED_PACKAGES).map(normalizeName),
  );
  for (const pkg of parseBlocklist(extraBlocklist)) {
    blocklistSet.add(pkg);
  }
  const blocked = new Set<string>();

  // --- package.json ---
  try {
    const raw = await fs.promises.readFile(path.join(workDir, 'package.json'), 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const npmPackages = extractNpmPackages(parsed);
    console.log('[package-scanner] package.json packages:', npmPackages);
    for (const pkg of npmPackages) {
      if (blocklistSet.has(normalizeName(pkg))) {
        blocked.add(pkg);
      }
    }
  } catch {
    // File absent or unparseable — skip
  }

  // --- requirements.txt ---
  try {
    const raw = await fs.promises.readFile(path.join(workDir, 'requirements.txt'), 'utf-8');
    const reqPackages = extractRequirementsTxtPackages(raw);
    console.log('[package-scanner] requirements.txt packages:', reqPackages);
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
    const raw = await fs.promises.readFile(path.join(workDir, 'pyproject.toml'), 'utf-8');
    const pyprojectPackages = extractPyprojectPackages(raw);
    console.log('[package-scanner] pyproject.toml packages:', pyprojectPackages);
    for (const pkg of pyprojectPackages) {
      if (blocklistSet.has(normalizeName(pkg))) {
        blocked.add(pkg);
      }
    }
  } catch {
    // File absent — skip
  }

  const blockedList = Array.from(blocked);
  console.log('[package-scanner] detected blocked packages:', blockedList);
  return { blocked: blockedList };
}
