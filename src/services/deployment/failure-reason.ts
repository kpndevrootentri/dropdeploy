import * as path from 'path';
import { getConfig } from '@/lib/config';

/** Longest reason stored on a deployment; the whole story stays in the build log. */
const MAX_LENGTH = 300;

// Words compilers, npm, pip, git and crashing apps put on the line that says what went wrong.
const ERROR_LINE = /error|exception|err!|fatal|\bfailed\b|\bcannot\b|can't|could not|not found|denied|no such file/i;
const WARNING_LINE = /^\W*(npm )?warn(ing)?\b/i;
// Lines that only announce the error printed under them: `npm error code ERESOLVE`, Next's or CRA's `Failed to compile.`.
const HEADING_LINE = /^(npm (error|ERR!)( code \S+)?|failed to compile\.?)$/i;
// Docker build output carries the worker's `[hh:mm:ss.mmm] ` stamp, and colours stderr.
const TIMESTAMP = /^\[\d{2}:\d{2}:\d{2}\.\d{3}\]\s*/;
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

/** `text` with each env var value (3+ characters; multi-line ones line by line) replaced by [REDACTED]. */
export function redact(text: string, envValues: string[]): string {
  const secrets = envValues.flatMap((v) => v.split('\n')).map((v) => v.trim()).filter((v) => v.length >= 3);
  for (const secret of secrets.sort((a, b) => b.length - a.length)) text = text.split(secret).join('[REDACTED]');
  return text;
}

/** `text` with the server's own directories cut from its paths: `<PROJECTS_DIR>/shop` reads `shop`. */
function hideServerDirs(text: string): string {
  const { PROJECTS_DIR, STATIC_SERVE_DIR, UPLOADS_DIR } = getConfig();
  const dirs = [PROJECTS_DIR, STATIC_SERVE_DIR, UPLOADS_DIR].map((d) => path.normalize(d).replace(/\/+$/, '')).filter((d) => d.length > 1);
  for (const dir of dirs.sort((a, b) => b.length - a.length)) text = text.split(`${dir}/`).join('').split(dir).join('…');
  return text;
}

/**
 * `lines` without npm ci's refusal. The Dockerfiles run `npm ci || npm install`, and npm ci refuses a
 * repo with no lockfile (or one out of sync) before npm install prints the error that stopped the build.
 */
function withoutNpmCiRefusal(lines: string[]): string[] {
  const start = lines.findIndex((l) => /^npm (error|ERR!) code EUSAGE$/i.test(l));
  const end = lines.findIndex((l, i) => i > start && /A complete log of this run/.test(l));
  return start >= 0 && end > start ? [...lines.slice(0, start), ...lines.slice(end + 1)] : lines;
}

/**
 * One line saying why a deployment failed, from the error that stopped it.
 *
 * Build and startup errors carry the tail of the build or app output after a
 * summary line, so the first line there that reads like an error (not a
 * warning, not a heading) is usually the cause; otherwise the summary is.
 * The server's directories are cut from paths and values of the project's env
 * vars are redacted (an app can print them), since mentors see this too.
 */
export function failureReason(message: string, envValues: string[] = []): string {
  const lines = message.replace(ANSI, '').split('\n').map((l) => l.replace(TIMESTAMP, '').trim()).filter(Boolean);
  const line = withoutNpmCiRefusal(lines).find((l) => ERROR_LINE.test(l) && !WARNING_LINE.test(l) && !HEADING_LINE.test(l) && !l.endsWith(':')) ?? lines[0] ?? 'Unknown error';
  // Directories first: an env value that is part of one would otherwise break the match and keep the path.
  const text = redact(hideServerDirs(line), envValues);
  return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH - 1)}…` : text;
}
