import { z } from 'zod';
import { baseEnvSchema, booleanFromEnv, validateEnv } from '@chicago-pizza/common';

export const notificationsEnvSchema = baseEnvSchema.extend({
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_SECURE: booleanFromEnv(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().default('Chicago Pizza <no-reply@chicago-pizza.ru>'),

  /**
   * Web Push signing keys. Optional on purpose: without them the browser
   * notification simply is not offered, and everything else — the stored
   * notification row, the email, the WebSocket nudge — carries on. A pizzeria
   * that has not generated a VAPID pair yet should still boot.
   *
   * Generate with `npx web-push generate-vapid-keys`.
   */
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  /** Contact address a push service can reach the sender at, per RFC 8292. */
  VAPID_SUBJECT: z.string().default('mailto:admin@chicago-pizza.ru'),
});

export function loadNotificationsEnv(raw: NodeJS.ProcessEnv) {
  return validateEnv(notificationsEnvSchema, raw);
}
