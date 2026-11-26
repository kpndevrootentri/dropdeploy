import { z } from 'zod';

/** POST /api/tokens body. */
export const createApiTokenSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name for the token').max(60, 'Keep the name to 60 characters or fewer'),
  scope: z.enum(['DEPLOY', 'FULL']).default('DEPLOY'),
  expiresInDays: z
    .union([z.literal(30), z.literal(90), z.literal(365), z.null()], {
      error: 'Expiry must be 30, 90 or 365 days, or no expiry',
    })
    .default(90),
  // Asked again so a stolen login (a 7-day CLI JWT, say) cannot turn itself into a token that never expires.
  password: z.string().min(1, 'Enter your password to create a token'),
});

export type CreateApiTokenDto = z.infer<typeof createApiTokenSchema>;
