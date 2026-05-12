import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile, writeFile, rename, mkdir, unlink } from 'node:fs/promises';

export interface Credentials {
  token: string;
  email: string;
  apiUrl: string;
}

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
  // Allow overriding via environment variable (useful in CI)
  if (process.env.DROPDEPLOY_TOKEN && process.env.DROPDEPLOY_URL) {
    return {
      token: process.env.DROPDEPLOY_TOKEN,
      email: process.env.DROPDEPLOY_EMAIL ?? 'env',
      apiUrl: process.env.DROPDEPLOY_URL,
    };
  }
  try {
    const raw = await readFile(credsPath(), 'utf8');
    return JSON.parse(raw) as Credentials;
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
    const err = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(err.message ?? `Login failed (${res.status})`);
  }
  const { data } = (await res.json()) as {
    data: { token: string; userId: string; email: string };
  };
  const creds: Credentials = { token: data.token, email: data.email, apiUrl: base };
  await saveCredentials(creds);
  return creds;
}
