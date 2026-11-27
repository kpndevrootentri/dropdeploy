import * as os from 'os';
import * as path from 'path';

/** The required variables; everything else falls back to its default. */
const REQUIRED = {
  DATABASE_URL: 'postgresql://dropdeploy:secret@localhost:5432/dropdeploy?schema=public',
  BASE_DOMAIN: 'entrify.site',
  NEXT_PUBLIC_BASE_DOMAIN: 'entrify.site',
  ENV_ENCRYPTION_KEY: 'a'.repeat(64),
};

const realEnv = process.env;
afterEach(() => {
  process.env = realEnv;
});

/** A fresh getConfig() over exactly `env` (plus HOME, which the default directories use). */
async function configFor(env: Record<string, string>): Promise<unknown> {
  process.env = { HOME: realEnv.HOME, ...env } as unknown as NodeJS.ProcessEnv;
  jest.resetModules();
  const { getConfig } = await import('@/lib/config');
  return getConfig();
}

describe('getConfig', () => {
  it('fills in every default when only the required variables are set', async () => {
    const base = path.join(os.homedir(), '.dropdeploy');
    expect(await configFor(REQUIRED)).toEqual({
      ...REQUIRED,
      REDIS_HOST: 'localhost',
      REDIS_PORT: 6379,
      JWT_EXPIRES_IN: '7d',
      NODE_ENV: 'development',
      PROJECTS_DIR: path.join(base, 'projects'),
      STATIC_SERVE_DIR: path.join(base, 'static-sites'),
      UPLOADS_DIR: path.join(base, 'uploads'),
      DOCKER_DATA_DIR: path.join(base, 'docker'),
      BULLMQ_CONCURRENCY: 5,
      BULLMQ_JOB_TIMEOUT_MS: 900_000,
      BUILD_MEMORY_MB: 3072,
      BUILD_CPUS: 2,
      BUILD_CACHE_MAX_MB: 4096,
      CONTAINER_READY_TIMEOUT_MS: 90_000,
      LOG_LEVEL: 'info',
      ALLOW_PUBLIC_REGISTRATION: false,
      CUSTOM_DOMAINS_ENABLED: false,
      TLS_CHECK_ENABLED: false,
      EDGE_TLS_ADDRESS: '127.0.0.1:443',
    });
  });

  it('coerces string values to numbers and flags', async () => {
    expect(
      await configFor({
        ...REQUIRED,
        REDIS_PORT: '6380',
        BULLMQ_CONCURRENCY: '7',
        BULLMQ_JOB_TIMEOUT_MS: '60000',
        BUILD_MEMORY_MB: '512',
        BUILD_CPUS: '1.5',
        CONTAINER_READY_TIMEOUT_MS: '5000',
        ALLOW_PUBLIC_REGISTRATION: ' TRUE ',
        CUSTOM_DOMAINS_ENABLED: 'false',
        TLS_CHECK_ENABLED: '',
        STATIC_SERVE_DIR: '/srv/static-sites',
        NODE_ENV: 'production',
        SES_REGION: '',
      }),
    ).toMatchObject({
      REDIS_PORT: 6380,
      BULLMQ_CONCURRENCY: 7,
      BULLMQ_JOB_TIMEOUT_MS: 60_000,
      BUILD_MEMORY_MB: 512,
      BUILD_CPUS: 1.5,
      CONTAINER_READY_TIMEOUT_MS: 5000,
      ALLOW_PUBLIC_REGISTRATION: true,
      CUSTOM_DOMAINS_ENABLED: false,
      TLS_CHECK_ENABLED: false,
      UPLOADS_DIR: '/srv/uploads',
      NODE_ENV: 'production',
      SES_REGION: '',
    });
  });

  it('turns a non-numeric REDIS_PORT into NaN rather than refusing it', async () => {
    expect(await configFor({ ...REQUIRED, REDIS_PORT: 'abc' })).toMatchObject({ REDIS_PORT: NaN });
  });

  // zod 4 trims a URL and drops tabs and line breaks from it; zod 3 kept it as given.
  it('trims URL values and drops tabs and line breaks from them', async () => {
    expect(await configFor({ ...REQUIRED, APP_URL: 'https://app.entrify.site/', NEXT_PUBLIC_APP_URL: 'http://localhost:3001' })).toMatchObject({
      APP_URL: 'https://app.entrify.site/',
      NEXT_PUBLIC_APP_URL: 'http://localhost:3001',
    });
    expect(await configFor({ ...REQUIRED, APP_URL: ' https://app.entrify.site/\n', NEXT_PUBLIC_APP_URL: 'http://local\thost:3001' })).toMatchObject({
      APP_URL: 'https://app.entrify.site/',
      NEXT_PUBLIC_APP_URL: 'http://localhost:3001',
    });
    expect(await configFor({ ...REQUIRED, DATABASE_URL: ` ${REQUIRED.DATABASE_URL}\r\n` })).toMatchObject({ DATABASE_URL: REQUIRED.DATABASE_URL });
  });

  it.each([
    ['BULLMQ_CONCURRENCY', '0'],
    ['BULLMQ_CONCURRENCY', '21'],
    ['BULLMQ_CONCURRENCY', '2.5'],
    ['BULLMQ_CONCURRENCY', 'abc'],
    ['BULLMQ_CONCURRENCY', ''],
    ['BULLMQ_JOB_TIMEOUT_MS', '59999'],
    ['BUILD_MEMORY_MB', '511'],
    ['BUILD_CPUS', '0.25'],
    ['BUILD_CACHE_MAX_MB', '511'],
    ['CONTAINER_READY_TIMEOUT_MS', '4999'],
    ['NODE_ENV', 'staging'],
    ['LOG_LEVEL', 'trace'],
    ['DATABASE_URL', 'not a url'],
    ['APP_URL', 'app.entrify.site'],
    ['CONTRIBUTOR_EMAIL', 'admin@localhost'],
    ['CONTRIBUTOR_PASSWORD', 'short'],
    ['INTERNAL_EDGE_TOKEN', 'too-short'],
    ['SES_REGION', 'mumbai'],
    ['BASE_DOMAIN', ''],
  ])('refuses %s=%j', async (key, value) => {
    await expect(configFor({ ...REQUIRED, [key]: value })).rejects.toThrow(/^Invalid env: /);
  });

  it('refuses a missing required variable', async () => {
    const rest: Record<string, string> = { ...REQUIRED };
    delete rest.DATABASE_URL;
    await expect(configFor(rest)).rejects.toThrow(/DATABASE_URL/);
  });

  it('names the problem for a short JWT_SECRET and a wrong-length encryption key', async () => {
    await expect(configFor({ ...REQUIRED, JWT_SECRET: 'secret' })).rejects.toThrow(/JWT_SECRET must be at least 24 characters/);
    await expect(configFor({ ...REQUIRED, ENV_ENCRYPTION_KEY: 'abc' })).rejects.toThrow(/Must be a 64-char hex string/);
  });
});
