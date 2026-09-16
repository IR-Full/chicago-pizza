import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  AddCartItemDto,
  ApplyPromocodeDto,
  CheckoutBodyDto,
  CreatePromocodeDto,
  SubmitReviewDto,
  UpdateCartItemDto,
  UpdateOrderStatusDto,
} from './orders.dto';

const UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

const parse = <T extends object>(cls: new () => T, raw: unknown) => plainToInstance(cls, raw);
const errorsFor = <T extends object>(cls: new () => T, raw: unknown) => validateSync(parse(cls, raw) as object);

describe('AddCartItemDto', () => {
  it('accepts a configured line', () => {
    expect(errorsFor(AddCartItemDto, { config: { productId: UUID, sizeCm: 45 }, quantity: 2 })).toHaveLength(0);
  });

  it('defaults the quantity to one', () => {
    expect(parse(AddCartItemDto, { config: { productId: UUID } }).quantity).toBe(1);
  });

  it('requires the configuration object', () => {
    // Without @IsDefined the whitelisting pipe silently strips `config` and
    // the orders service receives an item with no product.
    expect(errorsFor(AddCartItemDto, { quantity: 1 }).length).toBeGreaterThan(0);
  });

  it('validates inside the configuration', () => {
    const errors = errorsFor(AddCartItemDto, { config: { productId: 'pepperoni' }, quantity: 1 });

    expect(errors).toHaveLength(1);
    expect(errors[0].children?.[0].property).toBe('productId');
  });

  it.each([[0], [51], [1.5]])('rejects quantity %s', (quantity) => {
    expect(errorsFor(AddCartItemDto, { config: { productId: UUID }, quantity }).length).toBeGreaterThan(0);
  });
});

describe('UpdateCartItemDto', () => {
  it('allows zero as "remove this line"', () => {
    expect(errorsFor(UpdateCartItemDto, { quantity: 0 })).toHaveLength(0);
  });

  it.each([[-1], [51]])('rejects quantity %s', (quantity) => {
    expect(errorsFor(UpdateCartItemDto, { quantity }).length).toBeGreaterThan(0);
  });

  it('coerces the quantity from a string body', () => {
    expect(parse(UpdateCartItemDto, { quantity: '3' }).quantity).toBe(3);
  });
});

describe('CheckoutBodyDto', () => {
  it('defaults to an ASAP cash order', () => {
    const dto = parse(CheckoutBodyDto, { addressId: UUID });

    expect(dto.deliveryType).toBe('ASAP');
    expect(dto.paymentMethod).toBe('CASH_ON_DELIVERY');
    expect(errorsFor(CheckoutBodyDto, { addressId: UUID })).toHaveLength(0);
  });

  it('requires a time only for a scheduled delivery', () => {
    expect(errorsFor(CheckoutBodyDto, { addressId: UUID, deliveryType: 'SCHEDULED' }).length).toBeGreaterThan(0);
    expect(
      errorsFor(CheckoutBodyDto, {
        addressId: UUID,
        deliveryType: 'SCHEDULED',
        scheduledAt: '2026-09-20T18:30:00.000Z',
      }),
    ).toHaveLength(0);
  });

  it.each([
    ['a non-uuid address', { addressId: 'home' }],
    ['an unknown payment method', { addressId: UUID, paymentMethod: 'CRYPTO' }],
    ['an over-long comment', { addressId: UUID, comment: 'x'.repeat(501) }],
    ['negative points', { addressId: UUID, redeemPoints: -1 }],
  ])('rejects %s', (_label, raw) => {
    expect(errorsFor(CheckoutBodyDto, raw).length).toBeGreaterThan(0);
  });
});

describe('ApplyPromocodeDto', () => {
  it('requires a code of at most fifty characters', () => {
    expect(errorsFor(ApplyPromocodeDto, { code: 'CHICAGO10' })).toHaveLength(0);
    expect(errorsFor(ApplyPromocodeDto, {}).length).toBeGreaterThan(0);
    expect(errorsFor(ApplyPromocodeDto, { code: 'x'.repeat(51) }).length).toBeGreaterThan(0);
  });
});

describe('SubmitReviewDto', () => {
  it.each([[1], [3], [5]])('accepts a rating of %i', (rating) => {
    expect(errorsFor(SubmitReviewDto, { rating })).toHaveLength(0);
  });

  it.each([[0], [6], [4.5]])('rejects a rating of %s', (rating) => {
    expect(errorsFor(SubmitReviewDto, { rating }).length).toBeGreaterThan(0);
  });

  it('caps the comment', () => {
    expect(errorsFor(SubmitReviewDto, { rating: 5, comment: 'x'.repeat(1001) }).length).toBeGreaterThan(0);
  });
});

describe('UpdateOrderStatusDto', () => {
  it.each([['CREATED'], ['ACCEPTED'], ['PREPARING'], ['ON_DELIVERY'], ['DELIVERED'], ['CANCELLED']])(
    'accepts %s',
    (status) => {
      expect(errorsFor(UpdateOrderStatusDto, { status })).toHaveLength(0);
    },
  );

  it('rejects an invented status', () => {
    expect(errorsFor(UpdateOrderStatusDto, { status: 'LOST' }).length).toBeGreaterThan(0);
  });
});

describe('CreatePromocodeDto', () => {
  it('accepts a minimal percent code', () => {
    expect(errorsFor(CreatePromocodeDto, { code: 'CHICAGO10', discountType: 'PERCENT', discountValue: 10 })).toHaveLength(
      0,
    );
  });

  it('accepts all the optional limits', () => {
    const errors = errorsFor(CreatePromocodeDto, {
      code: 'NY2027',
      discountType: 'FIXED',
      discountValue: 20000,
      minOrderAmount: 100000,
      maxUses: 50,
      expiresAt: '2026-12-31T20:59:00.000Z',
    });

    expect(errors).toHaveLength(0);
  });

  it.each([
    ['a zero discount', { discountValue: 0 }],
    ['an unknown discount type', { discountType: 'BOGO' }],
    ['zero uses', { maxUses: 0 }],
    ['a negative minimum', { minOrderAmount: -1 }],
    ['a non-date expiry', { expiresAt: 'скоро' }],
  ])('rejects %s', (_label, override) => {
    const errors = errorsFor(CreatePromocodeDto, {
      code: 'CHICAGO10',
      discountType: 'PERCENT',
      discountValue: 10,
      ...override,
    });

    expect(errors.length).toBeGreaterThan(0);
  });
});
