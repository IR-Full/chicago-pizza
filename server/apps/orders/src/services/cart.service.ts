import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ConfiguredItemDto,
  PizzaConfigDto,
  PricedItem,
  PRODUCTS_PATTERNS,
  RedisCacheService,
  rpcSend,
} from '@chicago-pizza/common';
import { randomUUID } from 'crypto';

const CART_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days, matches the session TTL requirement
const MAX_CART_LINES = 50;

export interface CartLine {
  lineId: string;
  config: PizzaConfigDto;
  quantity: number;
}

export interface CartView {
  lines: (PricedItem & { lineId: string })[];
  subtotal: number;
  itemCount: number;
}

/**
 * The cart lives in Redis, not Postgres: it is high-churn, disposable state
 * that must survive a page reload but never needs to be reported on.
 * Only the item *configuration* is stored — prices are always recomputed by
 * the products service, so a stale or tampered cart can never fix a price.
 */
@Injectable()
export class CartService {
  constructor(
    private readonly cache: RedisCacheService,
    @Inject('PRODUCTS_SERVICE') private readonly products: ClientProxy,
  ) {}

  private key(userId: string) {
    return `cart:${userId}`;
  }

  async getRawLines(userId: string): Promise<CartLine[]> {
    return (await this.cache.get<CartLine[]>(this.key(userId))) ?? [];
  }

  async getCart(userId: string): Promise<CartView> {
    const lines = await this.getRawLines(userId);
    if (!lines.length) return { lines: [], subtotal: 0, itemCount: 0 };

    const items: ConfiguredItemDto[] = lines.map((l) => ({ config: l.config, quantity: l.quantity }));
    const priced = await rpcSend<{ items: PricedItem[]; subtotal: number }>(
      this.products,
      PRODUCTS_PATTERNS.VALIDATE_ORDER_ITEMS,
      { items },
    );

    return {
      lines: priced.items.map((item, idx) => ({ ...item, lineId: lines[idx].lineId })),
      subtotal: priced.subtotal,
      itemCount: lines.reduce((sum, l) => sum + l.quantity, 0),
    };
  }

  async addItem(userId: string, config: PizzaConfigDto, quantity: number): Promise<CartView> {
    // Price it first so an invalid configuration is rejected before it can
    // ever enter the cart.
    await rpcSend(this.products, PRODUCTS_PATTERNS.PRICE_PIZZA, { config, quantity });

    const lines = await this.getRawLines(userId);
    if (lines.length >= MAX_CART_LINES) throw new BadRequestException('Cart is full');

    // Identical configurations merge into one line instead of stacking up.
    const existing = lines.find((l) => this.sameConfig(l.config, config));
    if (existing) {
      existing.quantity = Math.min(existing.quantity + quantity, 50);
    } else {
      lines.push({ lineId: randomUUID(), config, quantity });
    }

    await this.save(userId, lines);
    return this.getCart(userId);
  }

  async updateItem(userId: string, lineId: string, quantity: number): Promise<CartView> {
    const lines = await this.getRawLines(userId);
    const line = lines.find((l) => l.lineId === lineId);
    if (!line) throw new NotFoundException('Cart line not found');

    if (quantity <= 0) {
      return this.removeItem(userId, lineId);
    }
    line.quantity = Math.min(quantity, 50);
    await this.save(userId, lines);
    return this.getCart(userId);
  }

  async removeItem(userId: string, lineId: string): Promise<CartView> {
    const lines = (await this.getRawLines(userId)).filter((l) => l.lineId !== lineId);
    await this.save(userId, lines);
    return this.getCart(userId);
  }

  async clear(userId: string): Promise<CartView> {
    await this.cache.del(this.key(userId));
    return { lines: [], subtotal: 0, itemCount: 0 };
  }

  async replaceLines(userId: string, lines: CartLine[]): Promise<CartView> {
    await this.save(userId, lines);
    return this.getCart(userId);
  }

  private save(userId: string, lines: CartLine[]) {
    return this.cache.set(this.key(userId), lines, CART_TTL_SECONDS);
  }

  private sameConfig(a: PizzaConfigDto, b: PizzaConfigDto): boolean {
    const norm = (ids?: string[]) => [...(ids ?? [])].sort().join(',');
    return (
      a.productId === b.productId &&
      (a.secondHalfProductId ?? null) === (b.secondHalfProductId ?? null) &&
      (a.sizeCm ?? null) === (b.sizeCm ?? null) &&
      (a.doughTypeId ?? null) === (b.doughTypeId ?? null) &&
      norm(a.addedIngredientIds) === norm(b.addedIngredientIds) &&
      norm(a.removedIngredientIds) === norm(b.removedIngredientIds)
    );
  }
}
