import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PriceItemBodyDto } from './catalog.dto';
import { AddCartItemDto } from './orders.dto';

/**
 * The gateway runs ValidationPipe with `whitelist + forbidNonWhitelisted`.
 * A nested object property with only `@Type()` and no `@ValidateNested()` is
 * invisible to the validator, so the pipe rejects the whole request with
 * "property config should not exist" — which is how the pizza constructor
 * broke in the first place. These tests reproduce the pipe's settings.
 */
function validateBody<T extends object>(cls: new () => T, payload: unknown) {
  const instance = plainToInstance(cls, payload, { enableImplicitConversion: false });
  return validateSync(instance as object, { whitelist: true, forbidNonWhitelisted: true });
}

const VALID_UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const OTHER_UUID = '9c858901-8a57-4791-81fe-4c455b099bc9';

describe('PriceItemBodyDto', () => {
  it('accepts a minimal pizza configuration', () => {
    const errors = validateBody(PriceItemBodyDto, {
      config: { productId: VALID_UUID, sizeCm: 45 },
      quantity: 1,
    });

    expect(errors).toHaveLength(0);
  });

  it('accepts a full 50/50 configuration with ingredient edits', () => {
    const errors = validateBody(PriceItemBodyDto, {
      config: {
        productId: VALID_UUID,
        secondHalfProductId: OTHER_UUID,
        sizeCm: 60,
        doughTypeId: OTHER_UUID,
        removedIngredientIds: [VALID_UUID],
      },
      quantity: 2,
    });

    expect(errors).toHaveLength(0);
  });

  it('strips a stale addedIngredientIds rather than refusing the line', () => {
    // Baskets live in Redis for a week, so a line saved before paid extras
    // were removed can still arrive carrying the field. A refusal would
    // strand that customer: they could neither order nor empty their cart.
    //
    // Validated the way the gateway actually validates — `whitelist` without
    // `forbidNonWhitelisted` (see `main.ts`, which explains why) — and not
    // through `validateBody` above, which adds the stricter flag and would
    // report a rejection production does not perform.
    const instance = plainToInstance(PriceItemBodyDto, {
      config: { productId: VALID_UUID, sizeCm: 60, addedIngredientIds: [OTHER_UUID] },
      quantity: 1,
    });
    const errors = validateSync(instance as object, { whitelist: true });

    expect(errors).toHaveLength(0);
    expect(instance.config).not.toHaveProperty('addedIngredientIds');
    expect(instance.config.productId).toBe(VALID_UUID);
  });

  it('rejects a non-uuid productId inside the nested config', () => {
    const errors = validateBody(PriceItemBodyDto, {
      config: { productId: 'not-a-uuid', sizeCm: 45 },
      quantity: 1,
    });

    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects an unknown property inside the nested config', () => {
    const errors = validateBody(PriceItemBodyDto, {
      config: { productId: VALID_UUID, sizeCm: 45, price: 1 },
      quantity: 1,
    });

    expect(errors.length).toBeGreaterThan(0);
  });

  it.each([0, -1, 51])('rejects quantity %i', (quantity) => {
    const errors = validateBody(PriceItemBodyDto, {
      config: { productId: VALID_UUID, sizeCm: 45 },
      quantity,
    });

    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('AddCartItemDto', () => {
  it('accepts a valid cart line', () => {
    const errors = validateBody(AddCartItemDto, {
      config: { productId: VALID_UUID, sizeCm: 30 },
      quantity: 1,
    });

    expect(errors).toHaveLength(0);
  });

  it('rejects a missing config', () => {
    expect(validateBody(AddCartItemDto, { quantity: 1 }).length).toBeGreaterThan(0);
  });
});
