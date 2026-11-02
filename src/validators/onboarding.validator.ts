import { z } from 'zod';
import { TOUR_STEP_IDS } from '@/lib/product-tour';

/** POST /api/onboarding/tour — how the dashboard tour ended. */
export const tourEndedSchema = z
  .object({
    outcome: z.enum(['completed', 'skipped', 'declined']),
    source: z.enum(['auto', 'menu']),
    // Null when the offer was declined before the tour started.
    last_step: z.enum(TOUR_STEP_IDS).nullable(),
  })
  .strict();

export type TourEnded = z.infer<typeof tourEndedSchema>;
