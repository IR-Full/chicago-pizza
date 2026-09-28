import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  MAX_LINE_QUANTITY,
  MAX_REMOVED_INGREDIENTS,
} from '../validation/rules';
import { ConfiguredItemDto, PizzaConfigDto, PriceItemsDto } from './pizza-config.dto';

const UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const OTHER_UUID = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

const errorsFor = <T>(cls: new () => T, raw: unknown) =>
  validateSync(plainToInstance(cls, raw) as object, { whitelist: false });

describe('PizzaConfigDto', () => {
  it('accepts the minimal config of a plain product', () => {
    expect(errorsFor(PizzaConfigDto, { productId: UUID })).toHaveLength(0);
  });

  it('accepts a full 50/50 constructor pizza', () => {
    const errors = errorsFor(PizzaConfigDto, {
      productId: UUID,
      secondHalfProductId: OTHER_UUID,
      sizeCm: 45,
      doughTypeId: OTHER_UUID,
      removedIngredientIds: [UUID],
    });

    expect(errors).toHaveLength(0);
  });

  it('requires the product id', () => {
    expect(errorsFor(PizzaConfigDto, {})).toHaveLength(1);
  });

  it.each([
    ['a non-uuid product', { productId: 'pepperoni' }],
    ['a non-uuid second half', { productId: UUID, secondHalfProductId: 'x' }],
    ['a non-uuid dough', { productId: UUID, doughTypeId: '12345' }],
    ['a fractional size', { productId: UUID, sizeCm: 45.5 }],
    ['ingredients that are not a list', { productId: UUID, removedIngredientIds: UUID }],
    ['a non-uuid inside the ingredient list', { productId: UUID, removedIngredientIds: [UUID, 'cheese'] }],
  ])('rejects %s', (_label, raw) => {
    expect(errorsFor(PizzaConfigDto, raw).length).toBeGreaterThan(0);
  });

  /**
   * The ceiling is read off the shared constant, not written out again: a
   * test with its own literal would let the two drift apart.
   */
  it('caps ingredient edits so one request cannot balloon the price calculation', () => {
    const fill = (length: number) => Array.from({ length }, () => UUID);

    expect(
      errorsFor(PizzaConfigDto, { productId: UUID, removedIngredientIds: fill(MAX_REMOVED_INGREDIENTS + 1) }),
    ).toHaveLength(1);
    expect(
      errorsFor(PizzaConfigDto, { productId: UUID, removedIngredientIds: fill(MAX_REMOVED_INGREDIENTS) }),
    ).toHaveLength(0);
  });

  it('no longer declares addedIngredientIds at all', () => {
    // Paid extras were removed. A basket saved before that can still carry
    // the field — Redis keeps carts for a week — and the gateway's pipe
    // strips it rather than refusing (see catalog.dto.spec). What matters
    // here is that the DTO does not describe it any more.
    expect(Object.keys(new PizzaConfigDto())).not.toContain('addedIngredientIds');
  });
});

describe('ConfiguredItemDto', () => {
  it('accepts a positive integer quantity', () => {
    expect(errorsFor(ConfiguredItemDto, { config: { productId: UUID }, quantity: 2 })).toHaveLength(0);
  });

  it.each([[0], [-1], [1.5]])('rejects quantity %s', (quantity) => {
    expect(errorsFor(ConfiguredItemDto, { config: { productId: UUID }, quantity }).length).toBeGreaterThan(0);
  });

  /**
   * The ceiling belongs here as well as in the pricing service. Without it a
   * quantity of a thousand travelled all the way to `PricingService`, which
   * refused it — and the cart reported the refusal as "this item is no longer
   * available" and dropped the line.
   */
  it('caps the quantity at the shared ceiling', () => {
    expect(
      errorsFor(ConfiguredItemDto, { config: { productId: UUID }, quantity: MAX_LINE_QUANTITY }),
    ).toHaveLength(0);
    expect(
      errorsFor(ConfiguredItemDto, { config: { productId: UUID }, quantity: MAX_LINE_QUANTITY + 1 }),
    ).toHaveLength(1);
  });

  it('validates the nested config rather than trusting it', () => {
    // Without @ValidateNested + @Type this passes silently — the exact bug
    // that would let an unchecked productId reach the pricing service.
    const errors = errorsFor(ConfiguredItemDto, { config: { productId: 'not-a-uuid' }, quantity: 1 });

    expect(errors).toHaveLength(1);
    expect(errors[0].children?.[0].property).toBe('productId');
  });
});

describe('PriceItemsDto', () => {
  it('accepts a batch of configured items', () => {
    const errors = errorsFor(PriceItemsDto, {
      items: [
        { config: { productId: UUID }, quantity: 1 },
        { config: { productId: OTHER_UUID, sizeCm: 60 }, quantity: 3 },
      ],
    });

    expect(errors).toHaveLength(0);
  });

  it('validates every element of the batch', () => {
    const errors = errorsFor(PriceItemsDto, {
      items: [{ config: { productId: UUID }, quantity: 1 }, { config: { productId: UUID }, quantity: 0 }],
    });

    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a payload whose items are not a list', () => {
    expect(errorsFor(PriceItemsDto, { items: 'nope' }).length).toBeGreaterThan(0);
  });
});
