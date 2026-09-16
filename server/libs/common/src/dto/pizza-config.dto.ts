import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsUUID, Min, ValidateNested } from 'class-validator';

/**
 * Describes one configurable line item. A plain product only needs
 * `productId` (+ `sizeCm` when the product has sizes). A constructor pizza
 * additionally carries the second half, dough type and ingredient edits.
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

  /** Extra ingredients added on top of the recipe — each is charged. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(15)
  @IsUUID(undefined, { each: true })
  addedIngredientIds?: string[];

  /** Recipe ingredients the customer removed — free, no refund. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(15)
  @IsUUID(undefined, { each: true })
  removedIngredientIds?: string[];
}

export class ConfiguredItemDto {
  @ValidateNested()
  @Type(() => PizzaConfigDto)
  config!: PizzaConfigDto;

  @IsInt()
  @Min(1)
  quantity!: number;
}

/** Result of pricing one configured item. */
export interface PricedItem {
  productId: string;
  productName: string;
  sizeLabel: string | null;
  doughTypeId: string | null;
  doughTypeName: string | null;
  secondHalfProductId: string | null;
  secondHalfName: string | null;
  addedIngredients: { id: string; name: string; price: number }[];
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
