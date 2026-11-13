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

/**
 * Parses .env text into [key, value] pairs, in file order.
 * `export ` prefixes, blank lines and comments are skipped; one pair of
 * surrounding quotes is removed, and `\n` in a double-quoted value is a newline.
 *
 * @example parseDotenv('A=1\n# note\nexport B="x y"') // [['A', '1'], ['B', 'x y']]
 */
export function parseDotenv(text: string): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const raw of text.split(/\r?\n/)) {
    const match = raw.trim().match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2];
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) {
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\n/g, '\n');
    } else {
      value = value.replace(/\s+#.*$/, ''); // trailing comment on an unquoted value
    }
    pairs.push([match[1], value]);
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

/** The message from an API error body: `{ error: { message } }`, `{ error }` or `{ message }`. */
export function apiErrorMessage(body: unknown, fallback: string): string {
  if (typeof body !== 'object' || body === null) return fallback;
  const { error, message } = body as { error?: unknown; message?: unknown };
  if (typeof error === 'object' && error !== null) {
    const nested = (error as { message?: unknown }).message;
    if (typeof nested === 'string' && nested) return nested;
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
const BOOLEAN_FLAGS = new Set(['json', 'create', 'follow', 'help', 'version']);

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
