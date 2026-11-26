// Fixed dummy env for every suite: a clean checkout (CI) needs no .env, and an
// exported dev .env cannot change results. Suites that need other values set them.
Object.assign(process.env, {
  DATABASE_URL: 'postgresql://test@localhost:5432/test',
  JWT_SECRET: 'x'.repeat(32),
  ENV_ENCRYPTION_KEY: '0'.repeat(64),
  BASE_DOMAIN: 'app.test',
  NEXT_PUBLIC_BASE_DOMAIN: 'app.test',
});
// A localhost NEXT_PUBLIC_APP_URL turns project links into /api/proxy/<slug> URLs.
delete process.env.NEXT_PUBLIC_APP_URL;
delete process.env.NEXT_PUBLIC_USE_LOCALHOST_DEPLOY_URL;
