import { z } from 'zod';

/** Proxy hits younger than this are never deleted, whatever is configured. */
export const MIN_PROXY_HIT_RETENTION_DAYS = 7;

export const updatePlatformSettingsSchema = z
  .object({
    defaultProjectQuota: z.number().int().min(0).max(1000),
    defaultDomainQuota: z.number().int().min(0).max(1000),
    signupOpen: z.boolean(),
    // An empty message clears the banner.
    bannerMessage: z.string().trim().max(500).nullable().transform((v) => v || null),
    proxyHitRetentionDays: z.number().int().min(MIN_PROXY_HIT_RETENTION_DAYS).max(3650),
  })
  .partial();

export type UpdatePlatformSettingsDto = z.infer<typeof updatePlatformSettingsSchema>;
