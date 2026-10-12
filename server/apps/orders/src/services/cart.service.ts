import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ConfiguredItemDto,
  deliveryFeeFor,
  FREE_DELIVERY_THRESHOLD,
  MAX_LINE_QUANTITY,
  PizzaConfigDto,
  PricedItem,
  PRODUCTS_PATTERNS,
  RedisCacheService,
  rpcSend,
} from '@chicago-pizza/common';
import { randomUUID } from 'crypto';

const CART_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days, matches the session TTL requirement
const MAX_CART_LINES = 50;

/**
 * The write lock on one customer's cart. Short, because it only ever guards a
 * Redis read and a Redis write, and a holder that dies must not lock the
 * customer out of their own basket.
 */
const LOCK_TTL_SECONDS = 30;
/** Two taps in quick succession: the second waits out the first, 10 × 30ms. */
const LOCK_ATTEMPTS = 10;
const LOCK_RETRY_MS = 30;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface CartLine {
  lineId: string;
  config: PizzaConfigDto;
  quantity: number;
}

/** A line dropped from the cart because it can no longer be priced. */
export interface RemovedCartLine {
  productId: string;
  /** Null when the product is gone from the catalogue entirely. */
  productName: string | null;
  reason: string;
}

export interface CartView {
  lines: (PricedItem & { lineId: string })[];
  subtotal: number;
  itemCount: number;
  /** Delivery terms, so the client never hardcodes the tariff. */
  deliveryFee: number;
  freeDeliveryThreshold: number;
  total: number;
  /** Lines removed on this read — the client tells the customer about them. */
  removed: RemovedCartLine[];
}

interface PricedCart {
  items: PricedItem[];
  subtotal: number;
  unavailable: { index: number; productId: string; productName: string | null; reason: string }[];
}

const emptyCart = (): CartView => ({
  lines: [],
  subtotal: 0,
  itemCount: 0,
  deliveryFee: deliveryFeeFor(0),
  freeDeliveryThreshold: FREE_DELIVERY_THRESHOLD,
  total: deliveryFeeFor(0),
  removed: [],
});

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

  /**
   * Prices a basket that has no account behind it yet.
   *
   * A guest's cart lives in their browser, not in Redis — there is no user id
   * to key it by. It still may not price itself: the totals a customer sees
   * before signing in have to come from the same authority as the ones they
   * are charged, or the number changes under them at the door.
   *
   * Unavailable lines are reported, not dropped: the browser owns the list
   * and is the only thing that can edit it.
   */
  async preview(lines: CartLine[]): Promise<CartView> {
    if (!lines.length) return emptyCart();

    const items: ConfiguredItemDto[] = lines.map((l) => ({ config: l.config, quantity: l.quantity }));
    const priced = await rpcSend<PricedCart>(this.products, PRODUCTS_PATTERNS.VALIDATE_ORDER_ITEMS, {
      items,
    });

    const dropped = new Set(priced.unavailable.map((u) => u.index));
    const keptLines = lines.filter((_, index) => !dropped.has(index));
    const subtotal = priced.subtotal;

    return {
      // Matched on the index the pricing carries, not on position: the answer
      // is short by however many lines it refused.
      lines: priced.items.map((item) => ({ ...item, lineId: lines[item.index].lineId })),
      subtotal,
      itemCount: keptLines.reduce((sum, l) => sum + l.quantity, 0),
      deliveryFee: deliveryFeeFor(subtotal),
      freeDeliveryThreshold: FREE_DELIVERY_THRESHOLD,
      total: subtotal + deliveryFeeFor(subtotal),
      removed: priced.unavailable.map(({ productId, productName, reason }) => ({
        productId,
        productName,
        reason,
      })),
    };
  }

  /**
   * Folds a guest's browser cart into their account's one at sign-in.
   *
   * Appending rather than replacing: someone who filled a cart on their phone
   * last week and another on a laptop just now meant both, and silently
   * discarding either is the kind of surprise that loses the order. Identical
   * configurations merge, exactly as `addItem` does.
   */
  async merge(userId: string, guestLines: CartLine[]): Promise<CartView> {
    if (!guestLines.length) return this.getCart(userId);

    return this.mutate(userId, (lines) => {
      for (const guest of guestLines) {
        const existing = lines.find((l) => this.sameConfig(l.config, guest.config));
        if (existing) {
          existing.quantity = Math.min(existing.quantity + guest.quantity, MAX_LINE_QUANTITY);
          continue;
        }
        // A full cart stops accepting rather than evicting what is already in
        // it: the account's own cart is the one the customer confirmed.
        if (lines.length >= MAX_CART_LINES) break;
        lines.push({ lineId: randomUUID(), config: guest.config, quantity: guest.quantity });
      }

      return lines;
    });
  }

  /**
   * Reads and values the cart.
   *
   * Writes only when the valuation actually changed something — a plain read is
   * a read. The header asks for this on every page load, and a write per read
   * would be a Redis round trip bought for nothing.
   */
  async getCart(userId: string): Promise<CartView> {
    const lines = await this.getRawLines(userId);
    const { view, droppedLines } = await this.price(lines);

    // A cart sits in Redis for a week, so a product can be delisted while it is
    // in there. Pruning those lines (and reporting them) keeps the cart usable;
    // failing the whole read used to leave the customer unable to either see
    // their cart or empty it.
    if (droppedLines.length) return this.mutate(userId, (current) => current);

    return view;
  }

  /**
   * Values a list of lines. Pure — it stores nothing.
   *
   * This is the single place the cart talks to the products service, which is
   * why one cart edit now costs one round trip instead of two. Keeping it free
   * of writes is what lets `mutate` price a *prospective* cart and only then
   * commit it, so a line the shop cannot price is never stored even briefly.
   */
  private async price(
    lines: CartLine[],
  ): Promise<{ view: CartView; keptLines: CartLine[]; droppedLines: CartLine[] }> {
    if (!lines.length) return { view: emptyCart(), keptLines: [], droppedLines: [] };

    const items: ConfiguredItemDto[] = lines.map((l) => ({ config: l.config, quantity: l.quantity }));
    const priced = await rpcSend<PricedCart>(this.products, PRODUCTS_PATTERNS.VALIDATE_ORDER_ITEMS, {
      items,
    });

    const droppedIndexes = new Set(priced.unavailable.map((u) => u.index));
    const keptLines = lines.filter((_, index) => !droppedIndexes.has(index));
    // The lines themselves, not just a count: `addItem` has to know whether the
    // configuration *it* just added was one of the refused ones.
    const droppedLines = lines.filter((_, index) => droppedIndexes.has(index));

    const subtotal = priced.subtotal;
    const deliveryFee = deliveryFeeFor(subtotal);

    return {
      keptLines,
      droppedLines,
      view: {
        lines: priced.items.map((item) => ({ ...item, lineId: lines[item.index].lineId })),
        subtotal,
        itemCount: keptLines.reduce((sum, l) => sum + l.quantity, 0),
        deliveryFee,
        freeDeliveryThreshold: FREE_DELIVERY_THRESHOLD,
        total: subtotal + deliveryFee,
        removed: priced.unavailable.map(({ productId, productName, reason }) => ({
          productId,
          productName,
          reason,
        })),
      },
    };
  }

  /**
   * Adds a configured item.
   *
   * There used to be a `PRICE_PIZZA` call here before the write, to reject an
   * invalid configuration early. It was redundant: `getCart` below re-prices the
   * whole basket over the same broker, and an unpriceable line comes back in
   * `unavailable`. Two round trips for one tap on "add to cart", and the second
   * one already knew everything the first asked.
   *
   * What the first call *did* provide was a refusal, and that is kept: an item
   * the shop cannot price must not silently vanish into an empty cart. It is now
   * read out of the re-pricing rather than asked for separately.
   */
  async addItem(userId: string, config: PizzaConfigDto, quantity: number): Promise<CartView> {
    const { view, droppedLines } = await this.mutateReportingDropped(userId, (lines) => {
      if (lines.length >= MAX_CART_LINES) throw new BadRequestException('Корзина переполнена');

      // Identical configurations merge into one line instead of stacking up.
      const existing = lines.find((l) => this.sameConfig(l.config, config));
      if (existing) {
        existing.quantity = Math.min(existing.quantity + quantity, MAX_LINE_QUANTITY);
      } else {
        lines.push({ lineId: randomUUID(), config, quantity });
      }

      return lines;
    });

    // Did *this* configuration survive pricing? The question used to be asked
    // of the product id instead, which is not the same question: a basket
    // already holding a 30 cm Pepperoni whose size has since been withdrawn
    // would report that product as removed, and adding a perfectly orderable
    // 45 cm one then failed with the other line's reason. Matching the
    // configuration asks about the line the customer just built.
    const rejectedIndex = droppedLines.findIndex((line) => this.sameConfig(line.config, config));
    if (rejectedIndex >= 0) {
      // Same ordering on both sides: `price` builds `droppedLines` and `removed`
      // from the one list of refused indexes.
      throw new BadRequestException(view.removed[rejectedIndex]?.reason ?? 'Товар недоступен');
    }

    return view;
  }

  async updateItem(userId: string, lineId: string, quantity: number): Promise<CartView> {
    if (quantity <= 0) return this.removeItem(userId, lineId);

    return this.mutate(userId, (lines) => {
      const line = lines.find((l) => l.lineId === lineId);
      if (!line) throw new NotFoundException('Позиция корзины не найдена');

      line.quantity = Math.min(quantity, MAX_LINE_QUANTITY);
      return lines;
    });
  }

  async removeItem(userId: string, lineId: string): Promise<CartView> {
    return this.mutate(userId, (lines) => lines.filter((l) => l.lineId !== lineId));
  }

  async clear(userId: string): Promise<CartView> {
    await this.cache.del(this.key(userId));
    return emptyCart();
  }

  async replaceLines(userId: string, lines: CartLine[]): Promise<CartView> {
    return this.mutate(userId, () => lines);
  }

  /**
   * Reads the cart, applies a change, writes it back — under a lock.
   *
   * Every cart edit is a read-modify-write against one Redis key, and they were
   * running unguarded. Two taps on "add to cart" close enough together both read
   * the same list, both append their own line to their own copy, and the second
   * write wins: one of the two pizzas is simply gone, with nothing anywhere
   * saying so. The same race loses a quantity change made from a second tab.
   *
   * A short lock per customer is enough — the contention here is one person's
   * own two clicks, not a crowd. A caller that cannot take it is told to retry
   * rather than left to overwrite: the alternative to a visible "try again" is
   * an invisible lost item.
   */
  private async mutate(userId: string, change: (lines: CartLine[]) => CartLine[]): Promise<CartView> {
    return (await this.mutateReportingDropped(userId, change)).view;
  }

  /** As `mutate`, but also says which lines valuation threw out. */
  private async mutateReportingDropped(
    userId: string,
    change: (lines: CartLine[]) => CartLine[],
  ): Promise<{ view: CartView; droppedLines: CartLine[] }> {
    const lockKey = `cart:lock:${userId}`;

    const owner = randomUUID();
    if (!(await this.acquire(lockKey, owner))) {
      throw new ConflictException('Корзина обновляется — попробуйте ещё раз');
    }

    try {
      const lines = await this.getRawLines(userId);
      // Priced before it is committed: the stored list is the one that survived
      // valuation, so an unpriceable line never reaches Redis at all.
      const { view, keptLines, droppedLines } = await this.price(change(lines));
      if (!(await this.cache.setWhileOwned(lockKey, owner, this.key(userId), keptLines, CART_TTL_SECONDS))) {
        throw new ConflictException('Корзина изменилась, повторите запрос');
      }
      return { view, droppedLines };
    } finally {
      await this.cache.releaseLock(lockKey, owner);
    }
  }

  private async acquire(lockKey: string, owner: string): Promise<boolean> {
    for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
      if (await this.cache.setIfAbsent(lockKey, owner, LOCK_TTL_SECONDS)) return true;
      await sleep(LOCK_RETRY_MS);
    }
    return false;
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
      (a.variantId ?? null) === (b.variantId ?? null) &&
      norm(a.removedIngredientIds) === norm(b.removedIngredientIds)
    );
  }
}
