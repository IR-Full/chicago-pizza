import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsUUID, Max, Min, ValidateNested } from 'class-validator';

import { MAX_LINE_QUANTITY, MAX_REMOVED_INGREDIENTS } from '../validation/rules';

/**
 * Describes one configurable line item. A plain product only needs
 * `productId` (+ `sizeCm` when the product has sizes). A constructor pizza
 * additionally carries the second half, the dough type, and any recipe
 * ingredients the customer asked to leave out.
 *
 * Shared between products (which prices and validates it) and orders (which
 * stores it on the order item), so both services agree on one shape.
 */
export class PizzaConfigDto {
  @IsUUID()
  productId!: string;

  /** Second half for a 50/50 pizza. When set, price is max(halfA, halfB) per business rule. */
  @IsOptional()
  @IsUUID()
  secondHalfProductId?: string;

  @IsOptional()
  @IsInt()
  sizeCm?: number;

  @IsOptional()
  @IsUUID()
  doughTypeId?: string;

  /**
   * Which flavour, for a product sold in several — Kinza comes as cola,
   * orange, lime-mint and three more at one price.
   *
   * Optional here because most products have no variants at all; pricing
   * refuses the line when the product *does* have them and this is missing,
   * because "Kinza" with no flavour is an order the kitchen cannot fill.
   */
  @IsOptional()
  @IsUUID()
  variantId?: string;

  /*
   * There is no `addedIngredientIds`. Paid extra toppings were built but the
   * pizzeria does not sell them, so the path is gone rather than disabled.
   *
   * A cart line saved before this change can still arrive carrying the old
   * field — baskets live in Redis for a week. That is harmless: the
   * validation pipe runs with `whitelist: true`, which strips properties no
   * DTO declares, and the line prices as the pizza without its extras.
   */

  /** Recipe ingredients the customer removed — free, no refund. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_REMOVED_INGREDIENTS)
  @IsUUID(undefined, { each: true })
  removedIngredientIds?: string[];
}

export class ConfiguredItemDto {
  @ValidateNested()
  @Type(() => PizzaConfigDto)
  config!: PizzaConfigDto;

  @IsInt()
  @Min(1)
  @Max(MAX_LINE_QUANTITY)
  quantity!: number;
}

/** Result of pricing one configured item. */
export interface PricedItem {
  /**
   * Which request line this price belongs to.
   *
   * Carried explicitly because `priceItems` *removes* the lines it cannot
   * price, so the answer is shorter than the question and the two stop lining
   * up. Callers that need the original line — the cart, to keep its `lineId`;
   * checkout, to store the configuration that was ordered — index by this,
   * never by position. `unavailable[].index` counts in the same scale.
   */
  index: number;
  productId: string;
  productName: string;
  sizeLabel: string | null;
  doughTypeId: string | null;
  doughTypeName: string | null;
  secondHalfProductId: string | null;
  secondHalfName: string | null;
  /** The chosen flavour's name, or null for a product sold only one way. */
  variantName: string | null;
  removedIngredients: { id: string; name: string }[];
  unitPrice: number;
  quantity: number;
  totalPrice: number;
  imageUrl: string | null;
}

export class PriceItemsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConfiguredItemDto)
  items!: ConfiguredItemDto[];
}
