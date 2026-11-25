import { z } from 'zod';

const name = z.string().trim().min(3).max(80);
const program = z.string().trim().min(1).max(80);

export const createCohortSchema = z
  .object({ name, program, startsAt: z.coerce.date(), endsAt: z.coerce.date() })
  .refine((c) => c.endsAt > c.startsAt, { message: 'The end date must be after the start date', path: ['endsAt'] });

export const updateCohortSchema = z
  .object({
    name,
    program,
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    joinOpen: z.boolean(),
    archived: z.boolean(),
  })
  .partial();

export const addMentorSchema = z.object({ email: z.string().trim().email() });

/** Checked one by one in the service, so a bad entry is reported instead of failing the list. */
export const addStudentsSchema = z.object({ emails: z.array(z.string().max(254)).min(1).max(100) });

/** Join codes are 24 base64url characters; the bounds only reject junk early. */
export const joinCodeSchema = z.string().trim().min(16).max(64).regex(/^[A-Za-z0-9_-]+$/, 'Invalid join code');

export type CreateCohortDto = z.infer<typeof createCohortSchema>;
export type UpdateCohortDto = z.infer<typeof updateCohortSchema>;
