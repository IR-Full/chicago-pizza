import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AddTicketMessageDto, CreateTicketDto, SubscribePushDto } from './support.dto';

const errorsFor = <T extends object>(cls: new () => T, raw: unknown) =>
  validateSync(plainToInstance(cls, raw) as object);

describe('CreateTicketDto', () => {
  const VALID = { subject: 'Холодная пицца', message: 'Привезли холодной' };

  it('accepts a ticket without an explicit channel', () => {
    expect(errorsFor(CreateTicketDto, VALID)).toHaveLength(0);
  });

  it.each([['TICKET'], ['CHAT']])('accepts the %s channel', (channel) => {
    expect(errorsFor(CreateTicketDto, { ...VALID, channel })).toHaveLength(0);
  });

  it('rejects an unknown channel', () => {
    expect(errorsFor(CreateTicketDto, { ...VALID, channel: 'TELEGRAM' }).length).toBeGreaterThan(0);
  });

  it.each([
    ['a too-short subject', { subject: 'ой' }],
    ['an over-long subject', { subject: 'я'.repeat(151) }],
    ['an empty message', { message: '' }],
    ['an over-long message', { message: 'я'.repeat(2001) }],
  ])('rejects %s', (_label, override) => {
    expect(errorsFor(CreateTicketDto, { ...VALID, ...override }).length).toBeGreaterThan(0);
  });

  it('accepts the boundary lengths', () => {
    expect(errorsFor(CreateTicketDto, { subject: 'ой!', message: 'я'.repeat(2000) })).toHaveLength(0);
  });
});

describe('AddTicketMessageDto', () => {
  it('requires a non-empty message of at most 2000 characters', () => {
    expect(errorsFor(AddTicketMessageDto, { message: 'Привет' })).toHaveLength(0);
    expect(errorsFor(AddTicketMessageDto, { message: '' }).length).toBeGreaterThan(0);
    expect(errorsFor(AddTicketMessageDto, { message: 'я'.repeat(2001) }).length).toBeGreaterThan(0);
  });
});

describe('SubscribePushDto', () => {
  it('accepts an endpoint with its keys', () => {
    expect(
      errorsFor(SubscribePushDto, { endpoint: 'https://push.example/1', keys: { p256dh: 'k', auth: 'a' } }),
    ).toHaveLength(0);
  });

  it('requires the endpoint to be a string', () => {
    expect(errorsFor(SubscribePushDto, { keys: {} }).length).toBeGreaterThan(0);
    expect(errorsFor(SubscribePushDto, { endpoint: 42, keys: {} }).length).toBeGreaterThan(0);
  });
});

/**
 * `keys` used to carry `@ApiProperty` and no validator. `whitelist: true`
 * strips every property it has no decorator for, so the field was deleted on
 * its way in and the insert then failed against a NOT NULL column — a 500 on
 * every single call. Swagger metadata is documentation; only a validator
 * makes a field real.
 */
describe('SubscribePushDto', () => {
  const VALID = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
    keys: { p256dh: 'BPublicKey', auth: 'AuthSecret' },
  };

  it('keeps the keys instead of silently dropping them', () => {
    const instance = plainToInstance(SubscribePushDto, VALID);

    expect(validateSync(instance, { whitelist: true })).toHaveLength(0);
    // The regression that mattered: after whitelisting, `keys` is still here.
    expect(instance.keys).toEqual({ p256dh: 'BPublicKey', auth: 'AuthSecret' });
  });

  it.each([
    ['keys missing entirely', { endpoint: VALID.endpoint }],
    ['a half-filled key pair', { ...VALID, keys: { p256dh: 'BPublicKey' } }],
    ['keys that are not strings', { ...VALID, keys: { p256dh: 1, auth: 2 } }],
  ])('rejects %s', (_label, payload) => {
    expect(validateSync(plainToInstance(SubscribePushDto, payload), { whitelist: true }).length)
      .toBeGreaterThan(0);
  });

  it.each([
    ['a plain-HTTP endpoint', 'http://push.example.com/send/abc'],
    ['something that is not a URL', 'not-a-url'],
  ])('rejects %s', (_label, endpoint) => {
    // The endpoint is a URL this server will later POST to; an unvalidated
    // one is a request-forgery primitive handed in by the client.
    expect(validateSync(plainToInstance(SubscribePushDto, { ...VALID, endpoint }), { whitelist: true }).length)
      .toBeGreaterThan(0);
  });
});
