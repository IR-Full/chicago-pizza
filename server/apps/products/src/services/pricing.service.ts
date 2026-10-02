import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService, ProductType } from '@chicago-pizza/prisma';
import {
  ConfiguredItemDto,
  isOrderable,
  MAX_LINE_QUANTITY,
  PizzaConfigDto,
  PricedItem,
} from '@chicago-pizza/common';

/**
 * This one line cannot be priced — the product is gone, the size no longer
 * exists, an ingredient left the catalogue.
 *
 * A distinct type because `priceItems` has to tell two refusals apart, and
 * `BadRequestException` alone could not. Everything `price` throws used to
 * come back as "this item is unavailable", including the quantity check —
 * so a basket with a tampered quantity was silently *emptied* of that line
 * and the customer was told the pizza had sold out. A malformed request is
 * not a menu change: it propagates, and the whole call is refused.
 *
 * Extends `BadRequestException` so the constructor's live-price endpoint,
 * which lets these through, keeps answering 400 exactly as before.
 */
export class UnpriceableLineException extends BadRequestException {}

/** A cart line that can no longer be priced — the product was delisted, or the
 *  size it was configured with no longer exists. */
export interface UnavailableItem {
  /** Position in the request, so the caller knows which of its lines to drop. */
  index: number;
  productId: string;
  /**
   * What it was called, when we still know — the cart tells the customer
   * which item it had to take out, and an id tells them nothing. Null for a
   * product that is no longer in the catalogue at all: there is no name left
   * to read, and the order line that would have carried one was never made.
   */
  productName: string | null;
  reason: string;
}

export interface PricedItemsResult {
  /**
   * Priceable lines, in request order, with the unavailable ones removed —
   * so this is shorter than the request whenever `unavailable` is non-empty.
   * Each carries the `index` of the request line it came from; match on that.
   */
  items: PricedItem[];
  subtotal: number;
  unavailable: UnavailableItem[];
}

type ProductWithRelations = {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  stoppedUntil: Date | null;
  basePrice: number;
  imageUrl: string | null;
  sizes: { id: string; sizeCm: number; label: string; price: number }[];
  variants: { id: string; name: string }[];
  productIngredients: { ingredientId: string; ingredient: { id: string; name: string } }[];
};

/** Everything a batch of lines needs, fetched once instead of per line. */
interface PricingContext {
  products: Map<string, ProductWithRelations>;
  doughTypes: Map<string, { id: string; name: string; priceModifier: number }>;
  // No ingredient map: the only thing that ever looked one up by id was the
  // paid-extras path, and the pizzeria does not sell extras. A recipe's own
  // ingredients arrive with the product.
}

/**
 * Single source of truth for what a configured item costs. The client shows a
 * live price using this same endpoint, and checkout re-prices server-side, so
 * a tampered client cannot influence the amount actually charged.
 *
 * Pricing rules:
 *  - Pizza base price comes from the chosen size row.
 *  - A 50/50 pizza costs the MAX of the two halves at that size (industry
 *    standard: the customer never pays less by pairing a cheap half).
 *  - Dough type adds a flat modifier.
 *  - Removing a recipe ingredient is free, and there is nothing to add: the
 *    pizzeria sells no paid extras, so nothing but size and dough moves the
 *    price.
 *  - Non-pizza products use `basePrice` and ignore size/dough/ingredients.
 */
@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Prices a whole cart. Lines that cannot be priced any more are reported
   * separately instead of failing the batch: the cart lives in Redis for a
   * week, so a product delisted in the meantime used to make every read of
   * that customer's cart return 404 — they could neither see it nor empty it.
   */
  async priceItems(items: ConfiguredItemDto[]): Promise<PricedItemsResult> {
    if (!items.length) return { items: [], subtotal: 0, unavailable: [] };

    // One round trip per entity type instead of up to four per line: a
    // ten-line cart used to cost forty sequential queries, on every page load
    // (the header reads the cart).
    const context = await this.loadContext(items.map((item) => item.config));

    const priced: PricedItem[] = [];
    const unavailable: UnavailableItem[] = [];

    items.forEach((item, index) => {
      try {
        priced.push(this.price(item.config, item.quantity, context, index));
      } catch (error) {
        if (error instanceof NotFoundException || error instanceof UnpriceableLineException) {
          unavailable.push({
            index,
            productId: item.config.productId,
            productName: context.products.get(item.config.productId)?.name ?? null,
            reason: error.message,
          });
          return;
        }
        throw error;
      }
    });

    return { items: priced, subtotal: priced.reduce((sum, i) => sum + i.totalPrice, 0), unavailable };
  }

  /** Prices one configuration. Unlike `priceItems` this throws, because the
   *  caller is the constructor asking about a choice just made. */
  async priceOne(config: PizzaConfigDto, quantity: number): Promise<PricedItem> {
    const context = await this.loadContext([config]);
    return this.price(config, quantity, context, 0);
  }

  // ── Loading ──────────────────────────────────────────────────

  private async loadContext(configs: PizzaConfigDto[]): Promise<PricingContext> {
    const productIds = new Set<string>();
    const doughIds = new Set<string>();

    for (const config of configs) {
      productIds.add(config.productId);
      if (config.secondHalfProductId) productIds.add(config.secondHalfProductId);
      if (config.doughTypeId) doughIds.add(config.doughTypeId);
    }

    const [products, doughTypes] = await Promise.all([
      this.prisma.product.findMany({
        where: { id: { in: [...productIds] } },
        include: { sizes: true, variants: true, productIngredients: { include: { ingredient: true } } },
      }),
      doughIds.size
        ? this.prisma.doughType.findMany({ where: { id: { in: [...doughIds] } } })
        : Promise.resolve([]),
    ]);

    return {
      products: new Map(products.map((p) => [p.id, p as unknown as ProductWithRelations])),
      doughTypes: new Map(doughTypes.map((d) => [d.id, d])),
    };
  }

  // ── Pricing ──────────────────────────────────────────────────

  private price(
    config: PizzaConfigDto,
    quantity: number,
    context: PricingContext,
    index: number,
  ): PricedItem {
    // Deliberately a plain BadRequest: see `UnpriceableLineException`.
    if (quantity < 1 || quantity > MAX_LINE_QUANTITY) {
      throw new BadRequestException(`Количество должно быть от 1 до ${MAX_LINE_QUANTITY}`);
    }

    const product = context.products.get(config.productId);
    if (!product) throw new NotFoundException('Товар недоступен');
    // Out of stock reads differently from delisted, and the customer can act
    // on the difference: one is worth waiting for, the other is not.
    if (!isOrderable(product)) {
      throw new NotFoundException(
        product.isActive ? `«${product.name}» сегодня закончилась` : 'Товар недоступен',
      );
    }

    const variantName = this.resolveVariant(product, config.variantId);

    if (product.type !== ProductType.PIZZA) {
      return this.priceSimpleProduct(product, quantity, index, variantName);
    }

    // ── Pizza ────────────────────────────────────────────────
    if (!config.sizeCm) throw new UnpriceableLineException('Для пиццы нужно выбрать размер');

    const size = product.sizes.find((s) => s.sizeCm === config.sizeCm);
    if (!size)
      throw new UnpriceableLineException(`Размер ${config.sizeCm} см недоступен для «${product.name}»`);

    let basePrice = size.price;
    let secondHalfName: string | null = null;

    if (config.secondHalfProductId) {
      if (config.secondHalfProductId === config.productId) {
        throw new UnpriceableLineException('Обе половинки не могут быть одной пиццей');
      }

      const secondHalf = context.products.get(config.secondHalfProductId);
      if (!secondHalf || !isOrderable(secondHalf) || secondHalf.type !== ProductType.PIZZA) {
        throw new UnpriceableLineException('Вторая половинка должна быть доступной пиццей');
      }

      const secondSize = secondHalf.sizes.find((s) => s.sizeCm === config.sizeCm);
      if (!secondSize) {
        throw new UnpriceableLineException(`Размер ${config.sizeCm} см недоступен для «${secondHalf.name}»`);
      }

      basePrice = Math.max(size.price, secondSize.price);
      secondHalfName = secondHalf.name;
    }

    let doughTypeName: string | null = null;
    if (config.doughTypeId) {
      const dough = context.doughTypes.get(config.doughTypeId);
      if (!dough) throw new UnpriceableLineException('Неизвестный вид теста');
      basePrice += dough.priceModifier;
      doughTypeName = dough.name;
    }

    const removedIngredients = this.resolveRemovedIngredients(
      product.productIngredients,
      config.removedIngredientIds ?? [],
    );

    return {
      index,
      productId: product.id,
      productName: secondHalfName ? `${product.name} / ${secondHalfName}` : product.name,
      sizeLabel: size.label,
      doughTypeId: config.doughTypeId ?? null,
      doughTypeName,
      secondHalfProductId: config.secondHalfProductId ?? null,
      secondHalfName,
      variantName,
      removedIngredients,
      unitPrice: basePrice,
      quantity,
      totalPrice: basePrice * quantity,
      imageUrl: product.imageUrl,
    };
  }

  private priceSimpleProduct(
    product: { id: string; name: string; basePrice: number; imageUrl: string | null },
    quantity: number,
    index: number,
    variantName: string | null,
  ): PricedItem {
    return {
      index,
      productId: product.id,
      productName: product.name,
      sizeLabel: null,
      doughTypeId: null,
      doughTypeName: null,
      secondHalfProductId: null,
      secondHalfName: null,
      variantName,
      removedIngredients: [],
      unitPrice: product.basePrice,
      quantity,
      totalPrice: product.basePrice * quantity,
      imageUrl: product.imageUrl,
    };
  }

  /**
   * The chosen flavour, for a product sold in more than one.
   *
   * A product with variants *must* be given one: a line that says "Kinza"
   * without saying which flavour is an order the kitchen cannot fill, and
   * refusing here is how the customer finds out at the constructor rather
   * than the courier finding out at the door.
   *
   * A product with no variants ignores the field instead of refusing — the
   * same way `priceSimpleProduct` ignores the size and dough a drink was
   * sent with. Carts live in Redis for a week and clients send stale shapes.
   */
  private resolveVariant(
    product: { name: string; variants: { id: string; name: string }[] },
    variantId: string | undefined,
  ): string | null {
    if (!product.variants.length) return null;

    if (!variantId) {
      throw new UnpriceableLineException(`Выберите вкус для «${product.name}»`);
    }

    const variant = product.variants.find((v) => v.id === variantId);
    if (!variant) {
      throw new UnpriceableLineException(`Такого вкуса у «${product.name}» нет`);
    }

    return variant.name;
  }

  private resolveRemovedIngredients(
    recipe: { ingredientId: string; ingredient: { id: string; name: string } }[],
    removedIds: string[],
  ) {
    const unique = [...new Set(removedIds)];
    const byId = new Map(recipe.map((r) => [r.ingredientId, r.ingredient]));

    return unique.map((id) => {
      const ingredient = byId.get(id);
      if (!ingredient) throw new UnpriceableLineException('Нельзя убрать ингредиент, которого нет в составе');
      return { id: ingredient.id, name: ingredient.name };
    });
  }
}
