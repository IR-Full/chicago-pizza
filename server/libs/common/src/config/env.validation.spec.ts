import { z } from 'zod';
import { baseEnvSchema, booleanFromEnv, validateEnv } from './env.validation';

const VALID: NodeJS.ProcessEnv = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/pizza',
  REDIS_URL: 'redis://localhost:6379',
  RABBITMQ_URL: 'amqp://localhost:5672',
};

describe('baseEnvSchema', () => {
  it('fills in the development defaults', () => {
    const env = validateEnv(baseEnvSchema, VALID);

    expect(env).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      CLIENT_URL: 'http://localhost:3000',
    });
  });

  it('coerces PORT from its string form', () => {
    expect(validateEnv(baseEnvSchema, { ...VALID, PORT: '4000' }).PORT).toBe(4000);
  });

  it.each([['test'], ['production'], ['development']])('accepts NODE_ENV=%s', (nodeEnv) => {
    expect(validateEnv(baseEnvSchema, { ...VALID, NODE_ENV: nodeEnv }).NODE_ENV).toBe(nodeEnv);
  });

  it.each([
    ['a missing database url', { ...VALID, DATABASE_URL: undefined }],
    ['an empty redis url', { ...VALID, REDIS_URL: '' }],
    ['a missing broker url', { ...VALID, RABBITMQ_URL: undefined }],
    ['an unknown NODE_ENV', { ...VALID, NODE_ENV: 'staging' }],
    ['a non-numeric port', { ...VALID, PORT: 'http' }],
    ['a negative port', { ...VALID, PORT: '-1' }],
  ])('fails fast on %s', (_label, raw) => {
    expect(() => validateEnv(baseEnvSchema, raw as NodeJS.ProcessEnv)).toThrow(/Invalid environment configuration/);
  });

  it('names every offending variable in the error', () => {
    expect(() => validateEnv(baseEnvSchema, {})).toThrow(/DATABASE_URL/);
    expect(() => validateEnv(baseEnvSchema, {})).toThrow(/RABBITMQ_URL/);
  });
});

describe('booleanFromEnv', () => {
  const schema = z.object({ FLAG: booleanFromEnv() });

  it.each([['true'], ['TRUE'], ['1'], ['yes'], ['on'], [' true ']])('reads %s as true', (raw) => {
    expect(schema.parse({ FLAG: raw }).FLAG).toBe(true);
  });

  it.each([['false'], ['FALSE'], ['0'], ['no'], ['off'], ['']])('reads %s as false', (raw) => {
    // The whole point of this helper: `z.coerce.boolean()` would call the
    // string "false" truthy and silently enable the feature.
    expect(schema.parse({ FLAG: raw }).FLAG).toBe(false);
  });

  it('passes real booleans through', () => {
    expect(schema.parse({ FLAG: true }).FLAG).toBe(true);
    expect(schema.parse({ FLAG: false }).FLAG).toBe(false);
  });

  it('applies the configured default when the variable is absent', () => {
    expect(z.object({ FLAG: booleanFromEnv() }).parse({}).FLAG).toBe(false);
    expect(z.object({ FLAG: booleanFromEnv(true) }).parse({}).FLAG).toBe(true);
  });
});

describe('validateEnv', () => {
  it('returns the parsed data for a schema extension', () => {
    const schema = baseEnvSchema.extend({ JWT_ACCESS_SECRET: z.string().min(8) });

    expect(validateEnv(schema, { ...VALID, JWT_ACCESS_SECRET: 'supersecret' })).toMatchObject({
      JWT_ACCESS_SECRET: 'supersecret',
    });
  });

  it('reports the failing extension field', () => {
    const schema = baseEnvSchema.extend({ SMTP_HOST: z.string().min(1) });

    expect(() => validateEnv(schema, VALID)).toThrow(/SMTP_HOST/);
  });
});
