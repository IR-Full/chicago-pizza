/**
 * Injection token lives in its own module: if it were exported from
 * `redis.module.ts`, the service importing it and the module importing the
 * service would form a cycle, and the token would evaluate to `undefined`
 * inside `@Inject()` at class-decoration time.
 */
export const REDIS_CLIENT = 'REDIS_CLIENT';
