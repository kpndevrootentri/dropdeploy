import { z } from 'zod';
import * as path from 'path';
import * as os from 'os';

const defaultBaseDir = path.join(os.homedir(), '.dropdeploy');

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.string().transform(Number).default('6379'),
  JWT_SECRET: z.string().min(1).optional(),
  JWT_EXPIRES_IN: z.string().default('7d'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
  BASE_DOMAIN: z.string().min(1),
  NEXT_PUBLIC_BASE_DOMAIN: z.string().min(1),
  ENV_ENCRYPTION_KEY: z.string().length(64, 'Must be a 64-char hex string (32 bytes)'),
  DOCKER_SOCKET: z.string().optional(),
  PROJECTS_DIR: z.string().default(path.join(defaultBaseDir, 'projects')),
  DOCKER_DATA_DIR: z.string().default(path.join(defaultBaseDir, 'docker')),
  NGINX_CONFIG_PATH: z.string().default('/etc/nginx/sites-enabled'),
  BULLMQ_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(5),
  BULLMQ_JOB_TIMEOUT_MS: z.coerce.number().int().min(60_000).default(15 * 60 * 1000),
  CONTRIBUTOR_EMAIL: z.string().email().optional(),
  CONTRIBUTOR_PASSWORD: z.string().min(8).optional(),
  // Comma-separated list of blocked package names (npm, pip, etc.)
  // e.g. "malicious-pkg,evil-lib,badware"
  BLOCKED_PACKAGES: z.string().optional(),
  // Logging level: error | warn | info | http | verbose | debug | silly
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly']).default('info'),
});

type Env = z.infer<typeof envSchema>;

let config: Env | null = null;

/**
 * Validated environment config. Call after env is loaded.
 * In development, missing JWT_SECRET is allowed.
 */
export function getConfig(): Env {
  if (config) return config;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid env: ${parsed.error.message}`);
  }
  config = parsed.data;
  return config;
}

export const isDevelopment = (): boolean => getConfig().NODE_ENV === 'development';
export const isProduction = (): boolean => getConfig().NODE_ENV === 'production';
export const isTest = (): boolean => getConfig().NODE_ENV === 'test';
