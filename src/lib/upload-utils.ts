export const UPLOAD_MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB

export type UploadFileType = 'zip' | 'html';

/** Detects the upload file type from MIME type + filename. Returns null if unsupported. */
export function detectUploadFileType(file: { type: string; name: string }): UploadFileType | null {
  if (file.type === 'application/zip' || file.name.endsWith('.zip')) return 'zip';
  if (file.type === 'text/html' || file.name.endsWith('.html') || file.name.endsWith('.htm')) return 'html';
  return null;
}

// Endings people add to a new copy of the same site: "-v2", ".v1.2", "_final", " (1)".
// A separator is required, so "dev2" or "game-2048" keep their digits.
const VERSION_SUFFIX = /(?:[\s._-]+(?:v\d+(?:\.\d+)*|final|\(\d+\)))+$/i;

/** A site name with its extension and version endings removed: "Portfolio-v2.0.html" → "portfolio". */
export function baseSiteName(name: string): string {
  return name
    .replace(/\.(zip|html?)$/i, '')
    .replace(VERSION_SUFFIX, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '-');
}

/**
 * The one project a dropped file is a new version of, or null. Several matches
 * (e.g. "portfolio" and "portfolio-v2" from before this existed) return null,
 * so the user picks rather than the wrong site being pre-selected.
 */
export function matchUploadProject<T extends { name: string }>(filename: string, projects: T[]): T | null {
  const base = baseSiteName(filename);
  if (!base) return null;
  const matches = projects.filter((p) => baseSiteName(p.name) === base);
  return matches.length === 1 ? matches[0] : null;
}
