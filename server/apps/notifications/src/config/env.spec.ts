import { loadNotificationsEnv, notificationsEnvSchema } from './env';

const BASE_ENV = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  RABBITMQ_URL: 'amqp://localhost:5672',
  SMTP_HOST: 'mailhog',
};

describe('notifications env schema', () => {
  describe('SMTP_SECURE coercion', () => {
    // Env vars are strings; a naive Boolean() cast turns "false" into true,
    // which would make the mailer negotiate TLS against a plaintext server.
    it.each(['false', 'FALSE', '0', 'no', 'off', ''])('treats %p as false', (value) => {
      const parsed = notificationsEnvSchema.parse({ ...BASE_ENV, SMTP_SECURE: value });
      expect(parsed.SMTP_SECURE).toBe(false);
    });

    it.each(['true', 'TRUE', '1', 'yes', 'on'])('treats %p as true', (value) => {
      const parsed = notificationsEnvSchema.parse({ ...BASE_ENV, SMTP_SECURE: value });
      expect(parsed.SMTP_SECURE).toBe(true);
    });

    it('defaults to false when unset', () => {
      expect(notificationsEnvSchema.parse(BASE_ENV).SMTP_SECURE).toBe(false);
    });
  });

  it('parses SMTP_PORT into a number', () => {
    expect(notificationsEnvSchema.parse({ ...BASE_ENV, SMTP_PORT: '2525' }).SMTP_PORT).toBe(2525);
  });

  it('rejects a configuration without required connection strings', () => {
    expect(() => notificationsEnvSchema.parse({ SMTP_HOST: 'mailhog' })).toThrow();
  });
});

describe('loadNotificationsEnv', () => {
  it('returns the parsed configuration', () => {
    expect(loadNotificationsEnv({ ...BASE_ENV } as NodeJS.ProcessEnv)).toMatchObject({
      SMTP_HOST: 'mailhog',
      SMTP_PORT: 1025,
      MAIL_FROM: 'Chicago Pizza <no-reply@chicago-pizza.ru>',
    });
  });

  it('refuses to boot without an SMTP host', () => {
    // Nest calls this from ConfigModule.forRoot, so a bad environment stops
    // the service at startup instead of at the first email.
    expect(() => loadNotificationsEnv({ ...BASE_ENV, SMTP_HOST: undefined } as NodeJS.ProcessEnv)).toThrow(
      /Invalid environment configuration/,
    );
  });
});
