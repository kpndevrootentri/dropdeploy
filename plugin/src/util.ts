import { basename } from 'node:path';

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
        const next = argv[i + 1];
        flags[arg.slice(2)] = next !== undefined && !next.startsWith('-') ? argv[++i] : 'true';
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
