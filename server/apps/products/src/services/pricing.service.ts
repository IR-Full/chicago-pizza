import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService, ProductType } from '@chicago-pizza/prisma';
import { ConfiguredItemDto, PizzaConfigDto, PricedItem } from '@chicago-pizza/common';

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

  async priceItems(items: ConfiguredItemDto[]): Promise<{ items: PricedItem[]; subtotal: number }> {
    if (!items.length) return { items: [], subtotal: 0 };

    const priced: PricedItem[] = [];
    for (const item of items) {
      priced.push(await this.priceOne(item.config, item.quantity));
    }
    const subtotal = priced.reduce((sum, i) => sum + i.totalPrice, 0);
    return { items: priced, subtotal };
  }

  async priceOne(config: PizzaConfigDto, quantity: number): Promise<PricedItem> {
    if (quantity < 1 || quantity > 50) {
      throw new BadRequestException('Quantity must be between 1 and 50');
    }

    const product = await this.prisma.product.findUnique({
      where: { id: config.productId },
      include: { sizes: true, productIngredients: { include: { ingredient: true } } },
    });
    if (!product || !product.isActive) throw new NotFoundException('Product not found or unavailable');

    if (product.type !== ProductType.PIZZA) {
      return this.priceSimpleProduct(product, quantity);
    }

    // ── Pizza ────────────────────────────────────────────────
    if (!config.sizeCm) throw new BadRequestException('Pizza requires a size');

    const size = product.sizes.find((s) => s.sizeCm === config.sizeCm);
    if (!size) throw new BadRequestException(`Size ${config.sizeCm} cm is not available for ${product.name}`);

    let basePrice = size.price;
    let secondHalfName: string | null = null;

    if (config.secondHalfProductId) {
      if (config.secondHalfProductId === config.productId) {
        throw new BadRequestException('Both halves cannot be the same pizza');
      }
      const secondHalf = await this.prisma.product.findUnique({
        where: { id: config.secondHalfProductId },
        include: { sizes: true },
      });
      if (!secondHalf || !secondHalf.isActive || secondHalf.type !== ProductType.PIZZA) {
        throw new BadRequestException('Second half must be an available pizza');
      }
      const secondSize = secondHalf.sizes.find((s) => s.sizeCm === config.sizeCm);
      if (!secondSize) {
        throw new BadRequestException(`Size ${config.sizeCm} cm is not available for ${secondHalf.name}`);
      }
      basePrice = Math.max(size.price, secondSize.price);
      secondHalfName = secondHalf.name;
    }

    let doughTypeName: string | null = null;
    if (config.doughTypeId) {
      const dough = await this.prisma.doughType.findUnique({ where: { id: config.doughTypeId } });
      if (!dough) throw new BadRequestException('Unknown dough type');
      basePrice += dough.priceModifier;
      doughTypeName = dough.name;
    }

    const addedIngredients = await this.resolveAddedIngredients(config.addedIngredientIds ?? []);
    basePrice += addedIngredients.reduce((sum, i) => sum + i.price, 0);

    const removedIngredients = this.resolveRemovedIngredients(product.productIngredients, config.removedIngredientIds ?? []);

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

  private async resolveAddedIngredients(ids: string[]) {
    if (!ids.length) return [];
    const unique = [...new Set(ids)];
    const ingredients = await this.prisma.ingredient.findMany({ where: { id: { in: unique } } });
    if (ingredients.length !== unique.length) {
      throw new BadRequestException('One or more added ingredients do not exist');
    }
    return ingredients.map((i) => ({ id: i.id, name: i.name, price: i.price }));
  }

  private resolveRemovedIngredients(
    recipe: { ingredientId: string; ingredient: { id: string; name: string } }[],
    removedIds: string[],
  ) {
    const unique = [...new Set(removedIds)];
    const byId = new Map(recipe.map((r) => [r.ingredientId, r.ingredient]));
    return unique.map((id) => {
      const ingredient = byId.get(id);
      if (!ingredient) throw new BadRequestException('Cannot remove an ingredient that is not in the recipe');
      return { id: ingredient.id, name: ingredient.name };
    });
  }
}
