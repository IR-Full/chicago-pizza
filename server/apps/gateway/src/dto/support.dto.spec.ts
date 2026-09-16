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
