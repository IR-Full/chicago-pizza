import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CheckoutDto } from './checkout.dto';

const UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

const parse = (raw: Record<string, unknown>) => plainToInstance(CheckoutDto, raw);
const errorsFor = (raw: Record<string, unknown>) => validateSync(parse(raw) as object);

describe('CheckoutDto', () => {
  it('accepts the default ASAP cash order', () => {
    const dto = parse({ addressId: UUID });

    expect(dto.deliveryType).toBe('ASAP');
    expect(dto.paymentMethod).toBe('CASH_ON_DELIVERY');
    expect(errorsFor({ addressId: UUID })).toHaveLength(0);
  });

  it('requires a real address id', () => {
    expect(errorsFor({}).length).toBeGreaterThan(0);
    expect(errorsFor({ addressId: 'home' }).length).toBeGreaterThan(0);
  });

  it('requires a time for a scheduled delivery', () => {
    // Without @ValidateIf this passes and the order is scheduled to `null`.
    expect(errorsFor({ addressId: UUID, deliveryType: 'SCHEDULED' }).length).toBeGreaterThan(0);
  });

  it('accepts a scheduled delivery with an ISO timestamp', () => {
    const errors = errorsFor({
      addressId: UUID,
      deliveryType: 'SCHEDULED',
      scheduledAt: '2026-09-20T18:30:00.000Z',
    });

    expect(errors).toHaveLength(0);
  });

  it('rejects a scheduled time that is not a date', () => {
    expect(
      errorsFor({ addressId: UUID, deliveryType: 'SCHEDULED', scheduledAt: 'через часок' }).length,
    ).toBeGreaterThan(0);
  });

  it('ignores the scheduled time for an ASAP order', () => {
    expect(errorsFor({ addressId: UUID, deliveryType: 'ASAP', scheduledAt: 'не важно' })).toHaveLength(0);
  });

  it.each([['CASH_ON_DELIVERY'], ['CARD_ON_DELIVERY']])('accepts payment method %s', (paymentMethod) => {
    expect(errorsFor({ addressId: UUID, paymentMethod })).toHaveLength(0);
  });

  it.each([
    ['an unknown payment method', { paymentMethod: 'CRYPTO' }],
    ['an unknown delivery type', { deliveryType: 'DRONE' }],
    ['an over-long comment', { comment: 'x'.repeat(501) }],
    ['an over-long promocode', { promocode: 'x'.repeat(51) }],
    ['negative points', { redeemPoints: -10 }],
    ['fractional points', { redeemPoints: 1.5 }],
  ])('rejects %s', (_label, override) => {
    expect(errorsFor({ addressId: UUID, ...override }).length).toBeGreaterThan(0);
  });

  it('coerces the redeemed points from a string', () => {
    const dto = parse({ addressId: UUID, redeemPoints: '250' });

    expect(dto.redeemPoints).toBe(250);
    expect(validateSync(dto as object)).toHaveLength(0);
  });

  it('accepts a full order', () => {
    const errors = errorsFor({
      addressId: UUID,
      deliveryType: 'SCHEDULED',
      scheduledAt: '2026-09-20T18:30:00.000Z',
      comment: 'Позвонить за 10 минут',
      promocode: 'CHICAGO10',
      redeemPoints: 300,
      paymentMethod: 'CARD_ON_DELIVERY',
    });

    expect(errors).toHaveLength(0);
  });
});
