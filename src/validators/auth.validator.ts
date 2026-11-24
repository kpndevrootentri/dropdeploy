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

/**
 * Trims, lowercases and de-duplicates a list of emails, drops blanks, and splits it into
 * valid and invalid addresses.
 */
export function splitEmails(input: string[]): { valid: string[]; invalid: string[] } {
  const emails = [...new Set(input.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const isEmail = (e: string): boolean => z.string().email().safeParse(e).success;
  return { valid: emails.filter(isEmail), invalid: emails.filter((e) => !isEmail(e)) };
}

export type RegisterDto = z.infer<typeof registerSchema>;
export type LoginDto = z.infer<typeof loginSchema>;
