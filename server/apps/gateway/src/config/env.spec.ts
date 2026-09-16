import { loadGatewayEnv } from './env';

const BASE: NodeJS.ProcessEnv = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/pizza',
  REDIS_URL: 'redis://localhost:6379',
  RABBITMQ_URL: 'amqp://localhost:5672',
  JWT_ACCESS_SECRET: 'access-secret-long-enough',
};

describe('loadGatewayEnv', () => {
  it('applies the rate-limit defaults', () => {
    expect(loadGatewayEnv(BASE)).toMatchObject({ THROTTLE_LIMIT: 100, THROTTLE_TTL_SECONDS: 60 });
  });

  it('coerces the throttle knobs from strings', () => {
    const env = loadGatewayEnv({ ...BASE, THROTTLE_LIMIT: '20', THROTTLE_TTL_SECONDS: '30' });

    expect(env.THROTTLE_LIMIT).toBe(20);
    expect(env.THROTTLE_TTL_SECONDS).toBe(30);
  });

  it('keeps the cookie domain optional for localhost deployments', () => {
    expect(loadGatewayEnv(BASE).COOKIE_DOMAIN).toBeUndefined();
    expect(loadGatewayEnv({ ...BASE, COOKIE_DOMAIN: '.chicago-pizza.ru' }).COOKIE_DOMAIN).toBe('.chicago-pizza.ru');
  });

  it.each([
    ['a missing access secret', { JWT_ACCESS_SECRET: undefined }],
    ['a short access secret', { JWT_ACCESS_SECRET: 'short' }],
  ])('refuses to boot with %s', (_label, override) => {
    // The gateway verifies every access token; a weak secret here is the
    // whole authentication system.
    expect(() => loadGatewayEnv({ ...BASE, ...override })).toThrow(/Invalid environment configuration/);
  });

  it.each([
    ['a zero throttle limit', { THROTTLE_LIMIT: '0' }],
    ['a negative window', { THROTTLE_TTL_SECONDS: '-1' }],
    ['a fractional limit', { THROTTLE_LIMIT: '1.5' }],
  ])('rejects %s', (_label, override) => {
    expect(() => loadGatewayEnv({ ...BASE, ...override })).toThrow(/Invalid environment configuration/);
  });

  it('still requires the shared base variables', () => {
    expect(() => loadGatewayEnv({ ...BASE, REDIS_URL: undefined })).toThrow(/REDIS_URL/);
  });
});
