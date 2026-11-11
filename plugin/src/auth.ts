import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile, writeFile, rename, mkdir, unlink } from 'node:fs/promises';
import { apiErrorMessage } from './util.js';

/** Where `entrify auth login` connects unless --api-url says otherwise. */
export const PRODUCTION_URL = 'https://entrify.site';
// ponytail: the platform moved from app.en3.wtf; drop this once that domain is retired.
const LEGACY_PRODUCTION_URL = 'https://app.en3.wtf';

/** Saved logins keep working after the move: same server, same token, new host. */
const currentUrl = (url: string): string =>
  url.replace(/\/$/, '') === LEGACY_PRODUCTION_URL ? PRODUCTION_URL : url;

export interface Credentials {
  token: string;
  email: string;
  apiUrl: string;
}

// Kept under the old name so logins saved by earlier versions keep working.
function configDir(): string {
  if (process.platform === 'win32' && process.env.APPDATA) {
    return join(process.env.APPDATA, 'dropdeploy');
  }
  return join(homedir(), '.config', 'dropdeploy');
}

const credsPath = () => join(configDir(), 'credentials.json');

export async function saveCredentials(creds: Credentials): Promise<void> {
  const dir = configDir();
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, '.credentials.tmp');
  await writeFile(tmp, JSON.stringify(creds, null, 2), { mode: 0o600 });
  await rename(tmp, credsPath());
}

export async function readCredentials(): Promise<Credentials | null> {
  // Allow overriding via environment variable (useful in CI). The DROPDEPLOY_* names still work.
  const env = process.env;
  const token = env.ENTRIFY_TOKEN ?? env.DROPDEPLOY_TOKEN;
  const url = env.ENTRIFY_URL ?? env.DROPDEPLOY_URL;
  if (token && url) {
    return {
      token,
      email: env.ENTRIFY_EMAIL ?? env.DROPDEPLOY_EMAIL ?? 'env',
      apiUrl: currentUrl(url),
    };
  }
  try {
    const raw = await readFile(credsPath(), 'utf8');
    const creds = JSON.parse(raw) as Credentials;
    return { ...creds, apiUrl: currentUrl(creds.apiUrl) };
  } catch {
    return null;
  }
}

export async function clearCredentials(): Promise<void> {
  await unlink(credsPath()).catch(() => {});
}

export async function login(
  apiUrl: string,
  email: string,
  password: string,
): Promise<Credentials> {
  const base = apiUrl.replace(/\/$/, '');
  try {
    const { protocol, hostname } = new URL(base);
    const isLocal = hostname === 'localhost' || hostname.startsWith('127.') || hostname.startsWith('192.168.');
    if (protocol === 'http:' && !isLocal) {
      process.stderr.write('\x1b[33m⚠  Warning: connecting over HTTP — credentials will be sent in plaintext.\x1b[0m\n');
    }
  } catch { /* invalid URL will be caught by the fetch below */ }
  const res = await fetch(`${base}/api/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    throw new Error(apiErrorMessage(body, `Login failed (${res.status})`));
  }
  const { data } = (await res.json()) as {
    data: { token: string; userId: string; email: string };
  };
  const creds: Credentials = { token: data.token, email: data.email, apiUrl: base };
  await saveCredentials(creds);
  return creds;
}
