import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { ValidationError } from '@/lib/errors';

const ALLOWED_EXTENSIONS = new Set([
  '.html', '.htm', '.css', '.js', '.mjs', '.cjs',
  '.json', '.svg', '.ico', '.png', '.jpg', '.jpeg',
  '.gif', '.webp', '.avif', '.woff', '.woff2', '.ttf',
  '.eot', '.xml', '.txt', '.map', '.webmanifest',
]);

const MAX_FILES = 500;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024; // 100 MB

function sanitizePath(entryName: string): string | null {
  // Normalize separators and strip leading slashes
  const normalized = entryName.replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized.split('/').some((part) => part === '..' || part === '')) return null;
  return normalized;
}

function isAllowed(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ALLOWED_EXTENSIONS.has(ext);
}

/**
 * Detects whether all non-directory entries share a single top-level folder prefix,
 * and returns that prefix to strip (e.g. "my-site/") or null if no unwrapping needed.
 */
function detectSingleTopLevelFolder(entries: AdmZip.IZipEntry[]): string | null {
  const fileEntries = entries.filter((e) => !e.isDirectory);
  if (fileEntries.length === 0) return null;

  const topLevels = new Set<string>();
  for (const entry of fileEntries) {
    const parts = entry.entryName.replace(/\\/g, '/').split('/');
    if (parts.length < 2) return null; // file at zip root — no unwrapping
    topLevels.add(parts[0]);
  }

  if (topLevels.size === 1) {
    return [...topLevels][0] + '/';
  }
  return null;
}

export async function extractZipToDir(buffer: Buffer, destDir: string): Promise<void> {
  // Extract to a staging directory first so the live destDir is untouched until
  // extraction is fully confirmed (atomic swap on success, cleanup on failure).
  const stagingDir = `${destDir}.staging-${Date.now()}`;
  await fs.promises.rm(stagingDir, { recursive: true, force: true });
  await fs.promises.mkdir(stagingDir, { recursive: true });

  try {
    let zip: AdmZip;
    try {
      zip = new AdmZip(buffer);
    } catch {
      throw new ValidationError('Invalid or corrupted zip file');
    }

    const entries = zip.getEntries();
    const fileEntries = entries.filter((e) => !e.isDirectory);

    if (fileEntries.length === 0) throw new ValidationError('Zip file contains no files');
    if (fileEntries.length > MAX_FILES) {
      throw new ValidationError(`Zip contains too many files (max ${MAX_FILES})`);
    }

    const stripPrefix = detectSingleTopLevelFolder(entries);
    // Resolve once outside the loop for the boundary check
    const resolvedStagingDir = path.resolve(stagingDir);

    let totalBytes = 0;
    for (const entry of fileEntries) {
      // Check declared uncompressed size BEFORE decompressing to prevent zip bomb OOM.
      // entry.header.size is the stored uncompressed size (can be 0 for stored entries).
      totalBytes += entry.header.size;
      if (totalBytes > MAX_TOTAL_BYTES) {
        throw new ValidationError('Extracted content exceeds 100 MB limit');
      }

      let relativePath = entry.entryName.replace(/\\/g, '/');

      if (stripPrefix && relativePath.startsWith(stripPrefix)) {
        relativePath = relativePath.slice(stripPrefix.length);
      }

      const safePath = sanitizePath(relativePath);
      if (!safePath) continue;

      if (!isAllowed(safePath)) continue;

      const destPath = path.join(stagingDir, safePath);

      // Boundary check: resolved path must stay inside stagingDir (catches ....// variants
      // and any OS-specific edge cases that slip past sanitizePath).
      const resolvedDestPath = path.resolve(destPath);
      if (!resolvedDestPath.startsWith(resolvedStagingDir + path.sep)) continue;

      const data = entry.getData();
      await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
      await fs.promises.writeFile(destPath, data);
    }

    // Require index.html at the root — not buried inside a sub-folder.
    // A common mistake is zipping .next/ (server build) instead of out/ (static export).
    // Having a root index.html is the only thing the static proxy can serve.
    const rootIndexExists = await fs.promises
      .access(path.join(stagingDir, 'index.html'))
      .then(() => true)
      .catch(() => false);

    if (!rootIndexExists) {
      // Check if this looks like a .next server build to give a more specific error
      const isNextBuild = await fs.promises
        .access(path.join(stagingDir, 'server', 'app'))
        .then(() => true)
        .catch(() => false);

      if (isNextBuild) {
        throw new ValidationError(
          'This looks like a .next server build, which cannot be served as a static site. ' +
          'Add output: "export" to next.config.ts, run next build, then zip the out/ folder.'
        );
      }

      throw new ValidationError(
        'No index.html found at the root of the zip. ' +
        'Make sure your build output (dist/, out/, build/) is at the top level of the zip, not nested inside a folder.'
      );
    }

    // Atomic swap: remove live dir and replace with fully-written staging dir
    await fs.promises.rm(destDir, { recursive: true, force: true });
    await fs.promises.rename(stagingDir, destDir);
  } catch (err) {
    await fs.promises.rm(stagingDir, { recursive: true, force: true });
    throw err;
  }
}

export async function writeSingleHtmlToDir(buffer: Buffer, destDir: string): Promise<void> {
  const stagingDir = `${destDir}.staging-${Date.now()}`;
  await fs.promises.rm(stagingDir, { recursive: true, force: true });
  await fs.promises.mkdir(stagingDir, { recursive: true });
  try {
    await fs.promises.writeFile(path.join(stagingDir, 'index.html'), buffer);
    await fs.promises.rm(destDir, { recursive: true, force: true });
    await fs.promises.rename(stagingDir, destDir);
  } catch (err) {
    await fs.promises.rm(stagingDir, { recursive: true, force: true });
    throw err;
  }
}

async function collectFiles(dir: string): Promise<string[]> {
  const result: string[] = [];
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await collectFiles(fullPath)));
    } else {
      result.push(fullPath);
    }
  }
  return result;
}
