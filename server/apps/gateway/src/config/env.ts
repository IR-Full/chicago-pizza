import { z } from 'zod';
import { baseEnvSchema, validateEnv } from '@chicago-pizza/common';

export const gatewayEnvSchema = baseEnvSchema.extend({
  JWT_ACCESS_SECRET: z.string().min(16),
  COOKIE_DOMAIN: z.string().optional(),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(100),
  THROTTLE_TTL_SECONDS: z.coerce.number().int().positive().default(60),
});

export function loadGatewayEnv(raw: NodeJS.ProcessEnv) {
  return validateEnv(gatewayEnvSchema, raw);
}
