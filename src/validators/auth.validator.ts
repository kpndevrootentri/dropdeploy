import { z } from 'zod';
import { joinCodeSchema } from './cohort.validator';

/** Every password a person chooses: a floor for strength, a ceiling so bcrypt is not fed megabytes. */
export const passwordSchema = z.string().min(8).max(128);

export const registerSchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
  name: z.string().trim().min(1).max(80).optional(),
  // A batch join code: lets this person sign up even when sign-up is closed, and joins them to the batch.
  joinCode: joinCodeSchema.optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type RegisterDto = z.infer<typeof registerSchema>;
export type LoginDto = z.infer<typeof loginSchema>;
