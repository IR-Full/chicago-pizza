import { loadAuthEnv } from './env';

const BASE: NodeJS.ProcessEnv = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/pizza',
  REDIS_URL: 'redis://localhost:6379',
  RABBITMQ_URL: 'amqp://localhost:5672',
  JWT_ACCESS_SECRET: 'access-secret-long-enough',
  JWT_REFRESH_SECRET: 'refresh-secret-long-enough',
};

describe('loadAuthEnv', () => {
  it('applies the production-safe defaults', () => {
    expect(loadAuthEnv(BASE)).toMatchObject({
      JWT_ACCESS_TTL: '15m',
      JWT_REFRESH_TTL_DAYS: 30,
      BCRYPT_SALT_ROUNDS: 12,
      LOGIN_MAX_ATTEMPTS: 5,
      LOGIN_LOCKOUT_MINUTES: 15,
    });
  });

  it('coerces the numeric knobs from their string form', () => {
    const env = loadAuthEnv({ ...BASE, BCRYPT_SALT_ROUNDS: '14', LOGIN_MAX_ATTEMPTS: '3' });

    expect(env.BCRYPT_SALT_ROUNDS).toBe(14);
    expect(env.LOGIN_MAX_ATTEMPTS).toBe(3);
  });

  it.each([
    ['a missing access secret', { JWT_ACCESS_SECRET: undefined }],
    ['a short access secret', { JWT_ACCESS_SECRET: 'tooshort' }],
    ['a missing refresh secret', { JWT_REFRESH_SECRET: undefined }],
    ['a short refresh secret', { JWT_REFRESH_SECRET: 'short' }],
  ])('refuses to boot with %s', (_label, override) => {
    // A weak or absent signing secret is the difference between a session and
    // a forgeable token, so this must fail at startup, not at first login.
    expect(() => loadAuthEnv({ ...BASE, ...override })).toThrow(/Invalid environment configuration/);
  });

  it.each([
    ['salt rounds below the floor', { BCRYPT_SALT_ROUNDS: '3' }],
    ['salt rounds above the ceiling', { BCRYPT_SALT_ROUNDS: '20' }],
    ['zero login attempts', { LOGIN_MAX_ATTEMPTS: '0' }],
    ['a negative lockout', { LOGIN_LOCKOUT_MINUTES: '-5' }],
    ['a fractional refresh ttl', { JWT_REFRESH_TTL_DAYS: '1.5' }],
  ])('rejects %s', (_label, override) => {
    expect(() => loadAuthEnv({ ...BASE, ...override })).toThrow(/Invalid environment configuration/);
  });

  it('still requires the shared base variables', () => {
    expect(() => loadAuthEnv({ ...BASE, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
  });
});
