import { z } from 'zod';

/**
 * Base env vars every microservice needs. Each app extends this with the
 * vars specific to its own domain (e.g. auth adds JWT secrets, notifications
 * adds SMTP creds) and calls `validateEnv` once at bootstrap so a
 * misconfigured deployment fails fast instead of at first use.
 */
/**
 * Env vars are always strings, and `z.coerce.boolean()` would treat the
 * string "false" as `true` (any non-empty string is truthy). This parses the
 * conventional textual spellings instead.
 */
export const booleanFromEnv = (defaultValue = false) =>
  z
    .union([z.boolean(), z.string()])
    .default(defaultValue)
    .transform((value) => {
      if (typeof value === 'boolean') return value;
      return ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase());
    });

export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  RABBITMQ_URL: z.string().min(1),
  CLIENT_URL: z.string().min(1).default('http://localhost:3000'),
});

export type BaseEnv = z.infer<typeof baseEnvSchema>;

export function validateEnv<T extends z.ZodTypeAny>(schema: T, raw: NodeJS.ProcessEnv): z.infer<T> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return result.data;
}
