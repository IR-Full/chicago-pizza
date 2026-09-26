import { ValidationPipe } from '@nestjs/common';
import { CORRELATION_ID_HEADER } from '@chicago-pizza/common';
import { RegisterDto } from './dto/register.dto';

/**
 * Every RPC payload carries the correlation id.
 *
 * `rpcSend` adds `x-request-id` to the message body, because RabbitMQ carries
 * no ambient context and without it the request trail stops at the gateway.
 * That makes the envelope a property no DTO declares — and this service used
 * to run its pipe with `forbidNonWhitelisted: true`, so it answered every
 * registration with "property x-request-id should not exist". Login survived
 * only because its handler binds an intersection type, which Nest cannot
 * validate at all; anything bound to a DTO class was dead.
 *
 * These tests exercise the real combination — the pipe, the DTO and the
 * envelope — which is the only place the bug was visible. The controller
 * tests call handlers directly and never see a pipe.
 */
const envelope = (overrides: Record<string, unknown> = {}) => ({
  email: 'amina@example.com',
  password: 'Guest123!',
  firstName: 'Амина',
  acceptPrivacyPolicy: true,
  [CORRELATION_ID_HEADER]: '3f2b1c9e',
  ...overrides,
});

const metadata = { type: 'body' as const, metatype: RegisterDto };

describe('auth RPC payloads', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true });

  it('accepts a registration carrying the correlation id', async () => {
    await expect(pipe.transform(envelope(), metadata)).resolves.toBeInstanceOf(RegisterDto);
  });

  it('strips the envelope before the DTO ever sees it', async () => {
    const dto = await pipe.transform(envelope(), metadata);

    expect(dto).not.toHaveProperty(CORRELATION_ID_HEADER);
    expect(dto).toMatchObject({ email: 'amina@example.com', firstName: 'Амина' });
  });

  it('still refuses a payload that is actually invalid', async () => {
    // Relaxing the pipe must not relax the rules the DTO does declare.
    await expect(pipe.transform(envelope({ email: 'not-an-email' }), metadata)).rejects.toThrow();
    await expect(pipe.transform(envelope({ acceptPrivacyPolicy: false }), metadata)).rejects.toThrow();
  });

  /** Pins the reason the option is off, so nobody turns it back on. */
  it('would reject the envelope with forbidNonWhitelisted', async () => {
    const strict = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

    // The pipe wraps the detail in a generic "Bad Request Exception", so the
    // reason has to be read off the response the caller would actually get.
    const rejection = await strict.transform(envelope(), metadata).then(
      () => null,
      (error: { getResponse(): { message?: string[] } }) => error.getResponse(),
    );

    expect(rejection?.message).toEqual(
      expect.arrayContaining([expect.stringContaining(CORRELATION_ID_HEADER)]),
    );
  });
});
