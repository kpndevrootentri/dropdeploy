import { z } from 'zod';
import { parseHookUrl } from '@/lib/outbound-webhook';

/** Events a hook can subscribe to. */
export const NOTIFICATION_EVENTS = ['deployment.succeeded', 'deployment.failed'] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export const createNotificationHookSchema = z.object({
  url: z
    .string()
    .trim()
    .max(2048, 'The URL is too long')
    .superRefine((value, ctx) => {
      try {
        parseHookUrl(value);
      } catch (err) {
        ctx.addIssue({ code: 'custom', message: (err as Error).message });
      }
    }),
  events: z.array(z.enum(NOTIFICATION_EVENTS)).min(1, 'Pick at least one event').default([...NOTIFICATION_EVENTS]),
});

export type CreateNotificationHookDto = z.infer<typeof createNotificationHookSchema>;
