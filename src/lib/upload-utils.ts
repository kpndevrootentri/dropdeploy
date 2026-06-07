export const UPLOAD_MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB

export type UploadFileType = 'zip' | 'html';

/** Detects the upload file type from MIME type + filename. Returns null if unsupported. */
export function detectUploadFileType(file: { type: string; name: string }): UploadFileType | null {
  if (file.type === 'application/zip' || file.name.endsWith('.zip')) return 'zip';
  if (file.type === 'text/html' || file.name.endsWith('.html') || file.name.endsWith('.htm')) return 'html';
  return null;
}
