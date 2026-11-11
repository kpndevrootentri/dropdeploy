/** Most lines of container output the admin panel can ask for at once. */
export const MAX_LOG_TAIL = 500;
export const DEFAULT_LOG_TAIL = 200;
/** Cap on the text returned, so a container that logs huge lines cannot blow up a response. */
export const MAX_LOG_BYTES = 256 * 1024;

/** Whole number of lines between 1 and MAX_LOG_TAIL; anything unparseable gets the default. */
export function clampTail(tail: unknown): number {
  const n = Number.parseInt(String(tail), 10);
  if (Number.isNaN(n)) return DEFAULT_LOG_TAIL;
  return Math.min(MAX_LOG_TAIL, Math.max(1, n));
}

/**
 * Turns the body of `GET /containers/{id}/logs` into text.
 *
 * A container without a TTY (every tenant container) sends frames: an 8-byte
 * header — stream type (0–2), three zero bytes, big-endian payload length —
 * then the payload. Frames are joined in order; output that does not start
 * with a valid header (a TTY container) is passed through as is.
 *
 * Keeps only the newest `maxBytes`, starting at a line boundary.
 */
export function demuxLogs(raw: Buffer, maxBytes = MAX_LOG_BYTES): string {
  const chunks: Buffer[] = [];
  let offset = 0;
  while (offset + 8 <= raw.length && raw[offset] <= 2 && raw.readUIntBE(offset + 1, 3) === 0) {
    const end = Math.min(offset + 8 + raw.readUInt32BE(offset + 4), raw.length);
    chunks.push(raw.subarray(offset + 8, end));
    offset = end;
  }
  if (offset < raw.length) chunks.push(raw.subarray(offset));

  const text = Buffer.concat(chunks);
  if (text.length <= maxBytes) return text.toString('utf8');
  const newest = text.subarray(text.length - maxBytes);
  // Drop the partial first line (and with it any split UTF-8 character).
  return `[earlier output truncated]\n${newest.subarray(newest.indexOf(0x0a) + 1).toString('utf8')}`;
}
