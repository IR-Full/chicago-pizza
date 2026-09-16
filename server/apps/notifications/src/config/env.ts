import { z } from 'zod';
import { baseEnvSchema, booleanFromEnv, validateEnv } from '@chicago-pizza/common';

export const notificationsEnvSchema = baseEnvSchema.extend({
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_SECURE: booleanFromEnv(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().default('Chicago Pizza <no-reply@chicago-pizza.ru>'),
});

export function loadNotificationsEnv(raw: NodeJS.ProcessEnv) {
  return validateEnv(notificationsEnvSchema, raw);
}
