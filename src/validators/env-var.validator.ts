import { z } from 'zod';
import { parseDotenv, type DotenvEntry, type DotenvProblem } from '@/lib/dotenv';

const envKeyRegex = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const createEnvVarSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(256)
    .regex(envKeyRegex, 'Key must be a valid environment variable name'),
  value: z.string().max(10_000),
  environment: z
    .enum(['DEVELOPMENT', 'STAGING', 'PRODUCTION', 'ALL'])
    .optional(),
});

export const updateEnvVarSchema = z.object({
  value: z.string().max(10_000),
});

/** Most variables one project may hold, across all its environments. */
export const MAX_ENV_VARS_PER_PROJECT = 500;

/** Most variables one .env paste or upload may set, counting each KEY=VALUE line. */
export const MAX_BULK_ENV_VARS = 200;

/** Room for 200 keys and values at their 256- and 10,000-character limits, plus quotes and line breaks. */
export const MAX_ENV_FILE_LENGTH = 2_100_000;

export const bulkEnvVarSchema = z.object({
  content: z.string().max(MAX_ENV_FILE_LENGTH, 'The .env file is too large'),
  environment: createEnvVarSchema.shape.environment,
});

/**
 * Reads .env text and checks every key and value as a single create does. A key given twice keeps
 * its last value, as in a .env file. `invalid` names lines and keys only, never values.
 * `tooMany` is set when more than MAX_BULK_ENV_VARS lines are KEY=VALUE or unreadable lines; reading
 * stops at the first line past the cap, so a huge file costs no more than a full one.
 */
export function checkEnvFile(content: string): { variables: DotenvEntry[]; invalid: DotenvProblem[]; tooMany: boolean } {
  const { entries, problems } = parseDotenv(content, MAX_BULK_ENV_VARS);
  const tooMany = entries.length + problems.length > MAX_BULK_ENV_VARS;
  const byKey = new Map<string, DotenvEntry>();
  for (const entry of entries) {
    const issue = createEnvVarSchema.safeParse(entry).error?.issues[0];
    if (issue) problems.push({ line: entry.line, key: entry.key, reason: issue.path[0] === 'value' ? `Value: ${issue.message}` : issue.message });
    else byKey.set(entry.key, entry);
  }
  return { variables: [...byKey.values()], invalid: problems.sort((a, b) => a.line - b.line), tooMany };
}
