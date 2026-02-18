import { z } from 'zod';

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
