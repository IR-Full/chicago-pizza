import { baseEnvSchema } from '@chicago-pizza/common';
import { ordersEnvSchema } from './env';

const BASE = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  RABBITMQ_URL: 'amqp://localhost:5672',
  CLIENT_URL: 'http://localhost:3000',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
};

describe('ordersEnvSchema', () => {
  it('boots a shop with no merchant account', () => {
    // Optional, not merely defaulted: a missing key must not stop the service.
    expect(() => ordersEnvSchema.parse(BASE)).not.toThrow();
  });

  it('keeps the credentials when they are given', () => {
    const parsed = ordersEnvSchema.parse({
      ...BASE,
      YOOKASSA_SHOP_ID: '123456',
      YOOKASSA_SECRET_KEY: 'live_secret',
    });

    expect(parsed).toMatchObject({ YOOKASSA_SHOP_ID: '123456', YOOKASSA_SECRET_KEY: 'live_secret' });
  });

  it('still enforces everything the base schema requires', () => {
    expect(() => ordersEnvSchema.parse({ ...BASE, DATABASE_URL: undefined })).toThrow();
    expect(Object.keys(baseEnvSchema.shape)).toContain('DATABASE_URL');
  });
});
