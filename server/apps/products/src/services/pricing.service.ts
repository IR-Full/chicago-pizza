import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService, ProductType } from '@chicago-pizza/prisma';
import { ConfiguredItemDto, PizzaConfigDto, PricedItem } from '@chicago-pizza/common';

/** A cart line that can no longer be priced — the product was delisted, or the
 *  size it was configured with no longer exists. */
export interface UnavailableItem {
  /** Position in the request, so the caller knows which of its lines to drop. */
  index: number;
  productId: string;
  reason: string;
}

export interface PricedItemsResult {
  /** Priceable lines, in request order, with the unavailable ones removed. */
  items: PricedItem[];
  subtotal: number;
  unavailable: UnavailableItem[];
}

type ProductWithRelations = {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  basePrice: number;
  imageUrl: string | null;
  sizes: { id: string; sizeCm: number; label: string; price: number }[];
  productIngredients: { ingredientId: string; ingredient: { id: string; name: string } }[];
};

/** Everything a batch of lines needs, fetched once instead of per line. */
interface PricingContext {
  products: Map<string, ProductWithRelations>;
  doughTypes: Map<string, { id: string; name: string; priceModifier: number }>;
  ingredients: Map<string, { id: string; name: string; price: number }>;
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
 *  - Each added ingredient is charged at its own price; removals are free.
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
        priced.push(this.price(item.config, item.quantity, context));
      } catch (error) {
        if (error instanceof NotFoundException || error instanceof BadRequestException) {
          unavailable.push({ index, productId: item.config.productId, reason: error.message });
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
    return this.price(config, quantity, context);
  }

  // ── Loading ──────────────────────────────────────────────────

  private async loadContext(configs: PizzaConfigDto[]): Promise<PricingContext> {
    const productIds = new Set<string>();
    const doughIds = new Set<string>();
    const ingredientIds = new Set<string>();

    for (const config of configs) {
      productIds.add(config.productId);
      if (config.secondHalfProductId) productIds.add(config.secondHalfProductId);
      if (config.doughTypeId) doughIds.add(config.doughTypeId);
      for (const id of config.addedIngredientIds ?? []) ingredientIds.add(id);
    }

    const [products, doughTypes, ingredients] = await Promise.all([
      this.prisma.product.findMany({
        where: { id: { in: [...productIds] } },
        include: { sizes: true, productIngredients: { include: { ingredient: true } } },
      }),
      doughIds.size
        ? this.prisma.doughType.findMany({ where: { id: { in: [...doughIds] } } })
        : Promise.resolve([]),
      ingredientIds.size
        ? this.prisma.ingredient.findMany({ where: { id: { in: [...ingredientIds] } } })
        : Promise.resolve([]),
    ]);

    return {
      products: new Map(products.map((p) => [p.id, p as unknown as ProductWithRelations])),
      doughTypes: new Map(doughTypes.map((d) => [d.id, d])),
      ingredients: new Map(ingredients.map((i) => [i.id, i])),
    };
  }

  // ── Pricing ──────────────────────────────────────────────────

  private price(config: PizzaConfigDto, quantity: number, context: PricingContext): PricedItem {
    if (quantity < 1 || quantity > 50) {
      throw new BadRequestException('Количество должно быть от 1 до 50');
    }

    const product = context.products.get(config.productId);
    if (!product || !product.isActive) throw new NotFoundException('Товар недоступен');

    if (product.type !== ProductType.PIZZA) {
      return this.priceSimpleProduct(product, quantity);
    }

    // ── Pizza ────────────────────────────────────────────────
    if (!config.sizeCm) throw new BadRequestException('Для пиццы нужно выбрать размер');

    const size = product.sizes.find((s) => s.sizeCm === config.sizeCm);
    if (!size) throw new BadRequestException(`Размер ${config.sizeCm} см недоступен для «${product.name}»`);

    let basePrice = size.price;
    let secondHalfName: string | null = null;

    if (config.secondHalfProductId) {
      if (config.secondHalfProductId === config.productId) {
        throw new BadRequestException('Обе половинки не могут быть одной пиццей');
      }

      const secondHalf = context.products.get(config.secondHalfProductId);
      if (!secondHalf || !secondHalf.isActive || secondHalf.type !== ProductType.PIZZA) {
        throw new BadRequestException('Вторая половинка должна быть доступной пиццей');
      }

      const secondSize = secondHalf.sizes.find((s) => s.sizeCm === config.sizeCm);
      if (!secondSize) {
        throw new BadRequestException(`Размер ${config.sizeCm} см недоступен для «${secondHalf.name}»`);
      }

      basePrice = Math.max(size.price, secondSize.price);
      secondHalfName = secondHalf.name;
    }

    let doughTypeName: string | null = null;
    if (config.doughTypeId) {
      const dough = context.doughTypes.get(config.doughTypeId);
      if (!dough) throw new BadRequestException('Неизвестный вид теста');
      basePrice += dough.priceModifier;
      doughTypeName = dough.name;
    }

    const addedIngredients = this.resolveAddedIngredients(config.addedIngredientIds ?? [], context);
    basePrice += addedIngredients.reduce((sum, i) => sum + i.price, 0);

    const removedIngredients = this.resolveRemovedIngredients(
      product.productIngredients,
      config.removedIngredientIds ?? [],
    );

    return {
      productId: product.id,
      productName: secondHalfName ? `${product.name} / ${secondHalfName}` : product.name,
      sizeLabel: size.label,
      doughTypeId: config.doughTypeId ?? null,
      doughTypeName,
      secondHalfProductId: config.secondHalfProductId ?? null,
      secondHalfName,
      addedIngredients,
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
  ): PricedItem {
    return {
      productId: product.id,
      productName: product.name,
      sizeLabel: null,
      doughTypeId: null,
      doughTypeName: null,
      secondHalfProductId: null,
      secondHalfName: null,
      addedIngredients: [],
      removedIngredients: [],
      unitPrice: product.basePrice,
      quantity,
      totalPrice: product.basePrice * quantity,
      imageUrl: product.imageUrl,
    };
  }

  private resolveAddedIngredients(ids: string[], context: PricingContext) {
    const unique = [...new Set(ids)];

    return unique.map((id) => {
      const ingredient = context.ingredients.get(id);
      if (!ingredient) throw new BadRequestException('Выбран несуществующий ингредиент');
      return { id: ingredient.id, name: ingredient.name, price: ingredient.price };
    });
  }

  private resolveRemovedIngredients(
    recipe: { ingredientId: string; ingredient: { id: string; name: string } }[],
    removedIds: string[],
  ) {
    const unique = [...new Set(removedIds)];
    const byId = new Map(recipe.map((r) => [r.ingredientId, r.ingredient]));

    return unique.map((id) => {
      const ingredient = byId.get(id);
      if (!ingredient) throw new BadRequestException('Нельзя убрать ингредиент, которого нет в составе');
      return { id: ingredient.id, name: ingredient.name };
    });
  }
}
