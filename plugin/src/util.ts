import { basename } from 'node:path';

/** Exit codes scripts and agents can branch on. */
export const EXIT = { FAILED: 1, NEEDS_INPUT: 2, AUTH: 3 } as const;

/**
 * An error with a stable machine-readable `code` (shown in `--json` output)
 * and the exit code to leave with. `details` is merged into the JSON output.
 */
export class CliError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly exitCode: number = EXIT.FAILED,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** Index of the `"` that closes a double-quoted value, or -1. A backslash escapes the next character. */
function closingQuote(s: string): number {
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\') i++;
    else if (s[i] === '"') return i;
  }
  return -1;
}

/**
 * Parses .env text into [key, value] pairs, in file order. Same rules as the dashboard's
 * src/lib/dotenv.ts, so a file means the same in both: `export ` prefixes, blank lines and
 * comments are skipped; single quotes are literal; double quotes may span lines and turn
 * `\n`, `\"` and `\\` into a newline, a quote and a backslash; an unquoted value ends at ` #`.
 * Lines that are not a valid `KEY=VALUE` are skipped; an unclosed double quote throws.
 *
 * @example parseDotenv('A=1\n# note\nexport B="x y"') // [['A', '1'], ['B', 'x y']]
 */
export function parseDotenv(text: string): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trimStart();
    if (!raw || raw.startsWith('#')) continue;
    const match = raw.match(/^(?:export\s+)?([^\s=]+)\s*=([\s\S]*)$/);
    if (!match) continue;
    const [, key, rest] = match;
    const quoted = rest.trimStart();
    let value: string;
    if (quoted.startsWith('"')) {
      // One line at a time, joined once at the end: growing one string and rescanning it is quadratic.
      const parts = [quoted.slice(1)];
      let end = closingQuote(parts[0]);
      while (end < 0 && i + 1 < lines.length) {
        parts.push(lines[++i]);
        end = closingQuote(parts[parts.length - 1]);
      }
      if (end < 0) throw new CliError(`The double-quoted value of ${key} is never closed`, 'INVALID_ENV_FILE', EXIT.NEEDS_INPUT);
      parts[parts.length - 1] = parts[parts.length - 1].slice(0, end);
      value = parts.join('\n').replace(/\\(["\\n])/g, (_, c: string) => (c === 'n' ? '\n' : c));
    } else if (quoted.startsWith("'") && quoted.indexOf("'", 1) > 0) {
      value = quoted.slice(1, quoted.indexOf("'", 1));
    } else {
      value = rest.replace(/\s#[\s\S]*$/, '').trim();
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) pairs.push([key, value]);
  }
  return pairs;
}

/**
 * A project name for a repository: its last path segment, padded or cut to
 * the 3–50 characters the API accepts.
 *
 * @example projectNameFromRepo('git@github.com:me/my-app.git') // 'my-app'
 */
export function projectNameFromRepo(remoteUrl: string): string {
  const name = normaliseRepoUrl(remoteUrl).split('/').pop() || 'app';
  return (name.length < 3 ? `${name}-app` : name).slice(0, 50);
}

/**
 * The deployment a rollback should return to: the newest successful one
 * before the live one. `deployments` is newest first.
 */
export function previousDeployed<T extends { status: string }>(deployments: T[]): T | null {
  return deployments.filter((d) => d.status === 'DEPLOYED')[1] ?? null;
}

/**
 * The command the user typed, so hints match it: the package installs both
 * `entrify` and the older `dropdeploy`.
 */
export function cliName(argv1: string | undefined = process.argv[1]): string {
  return basename(argv1 ?? '') === 'dropdeploy' ? 'dropdeploy' : 'entrify';
}

/**
 * Reduces a repository URL to `host/owner/repo`, so the HTTPS URL a project
 * stores matches an SSH remote such as `git@github.com:owner/repo.git`.
 */
export function normaliseRepoUrl(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^[a-z+]+:\/\//, '') // https://, ssh://, git+ssh://
    .replace(/^[^@/]+@/, '') // git@ or user:token@
    .replace(/^([^/:]+):(?!\d+\/)/, '$1/') // scp-style host:owner/repo
    .replace(/^([^/:]+):\d+\//, '$1/') // host:port/
    .replace(/\/+$/, '')
    .replace(/\.git$/, '');
}

/**
 * The message from an API error body: `{ error: { message } }`, `{ error }` or `{ message }`.
 * A validation error's first detail is appended: `Validation failed: <what is wrong>`.
 */
export function apiErrorMessage(body: unknown, fallback: string): string {
  if (typeof body !== 'object' || body === null) return fallback;
  const { error, message } = body as { error?: unknown; message?: unknown };
  if (typeof error === 'object' && error !== null) {
    const { message: nested, details } = error as { message?: unknown; details?: unknown };
    const detail = Array.isArray(details) ? (details[0] as { message?: unknown } | null)?.message : undefined;
    if (typeof nested === 'string' && nested) return typeof detail === 'string' && detail ? `${nested}: ${detail}` : nested;
  }
  if (typeof error === 'string' && error) return error;
  if (typeof message === 'string' && message) return message;
  return fallback;
}

/** A deployed project's address. Local dev serves projects through the app's proxy route. */
export function buildDeployUrl(apiUrl: string, subdomain: string): string {
  try {
    const u = new URL(apiUrl);
    if (u.hostname === 'localhost' || u.hostname.startsWith('127.')) {
      return `${u.origin}/api/proxy/${subdomain}`;
    }
    return `${u.protocol}//${subdomain}.${u.hostname}`;
  } catch {
    return `${apiUrl.replace(/\/$/, '')}/api/proxy/${subdomain}`;
  }
}

/** On/off flags: they never take the next word as a value, so `--json env list` keeps `env` a command. */
const BOOLEAN_FLAGS = new Set(['json', 'create', 'follow', 'help', 'version', 'dry-run']);

/** Splits argv into positional words and `--flag value` / `--flag=value` / bare `--flag` flags. */
export function parseArgs(argv: string[]): { command: string[]; flags: Record<string, string> } {
  const command: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq > 2) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        const name = arg.slice(2);
        const next = argv[i + 1];
        flags[name] = !BOOLEAN_FLAGS.has(name) && next !== undefined && !next.startsWith('-') ? argv[++i] : 'true';
      }
    } else if (arg === '-v') {
      flags['version'] = 'true';
    } else if (arg === '-h') {
      flags['help'] = 'true';
    } else {
      command.push(arg);
    }
  }
  return { command, flags };
}
