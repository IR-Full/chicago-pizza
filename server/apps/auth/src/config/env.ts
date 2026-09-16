import { z } from 'zod';
import { baseEnvSchema, validateEnv } from '@chicago-pizza/common';

export const authEnvSchema = baseEnvSchema.extend({
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
  BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),
});

export type AuthEnv = z.infer<typeof authEnvSchema>;

export function loadAuthEnv(raw: NodeJS.ProcessEnv): AuthEnv {
  return validateEnv(authEnvSchema, raw);
}
