import { BadRequestException, NotFoundException } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { CartService, CartLine } from './cart.service';

/**
 * The cart is Redis-backed and deliberately price-free: only configurations
 * are stored, and every read re-prices through the products service. These
 * tests pin that contract — a cart that could carry its own prices would let
 * a client pay whatever it liked.
 */
function createService(initialLines: CartLine[] | null = null) {
  const store = new Map<string, unknown>();
  if (initialLines) store.set('cart:user-1', initialLines);

  const cache = {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: unknown, _ttl?: number) => {
      store.set(key, value);
    }),
    del: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    // Every cart edit takes a per-customer write lock, so two taps cannot both
    // read the same list and have the second write win.
    setIfAbsent: jest.fn(async (key: string, value: unknown, _ttl: number) => {
      if (store.has(key)) return false;
      store.set(key, value);
      return true;
    }),
  };

  // The products service answers both the validate-cart and price-one calls.
  const unavailableProductIds = new Set<string>();
  /** Refuses particular *configurations*, not whole products. */
  let unpriceable: (config: any) => boolean = () => false;
  const refuses = (config: any) => unavailableProductIds.has(config.productId) || unpriceable(config);

  const send = jest.fn((pattern: string, payload: any) => {
    if (pattern === 'products.validate_order_items') {
      const unavailable = payload.items
        .map((item: any, index: number) => ({ item, index }))
        .filter(({ item }: any) => refuses(item.config))
        .map(({ item, index }: any) => ({
          index,
          productId: item.config.productId,
          // Named where the catalogue still knows the name, as the real
          // pricing service does — the cart shows this to the customer.
          productName: `Товар ${item.config.productId}`,
          reason: 'Товар недоступен',
        }));

      // Each priced line carries the index of the *request* line it came
      // from, exactly as the real pricing service does — the positions no
      // longer agree once anything is dropped.
      const items = payload.items
        .map((item: any, index: number) => ({ item, index }))
        .filter(({ item }: any) => !refuses(item.config))
        .map(({ item, index }: any) => ({
          index,
          productId: item.config.productId,
          productName: `Товар ${index + 1}`,
          unitPrice: 10000,
          quantity: item.quantity,
          totalPrice: 10000 * item.quantity,
        }));

      return of({ items, subtotal: items.reduce((sum: number, i: any) => sum + i.totalPrice, 0), unavailable });
    }
    return of({ unitPrice: 10000, totalPrice: 10000 * payload.quantity });
  });

  const products = { send } as any;

  return {
    service: new CartService(cache as never, products),
    cache,
    products,
    store,
    /** Marks a product as delisted for the next pricing call. */
    delist: (productId: string) => unavailableProductIds.add(productId),
    /** Refuses only the configurations matching `predicate` — e.g. one size. */
    delistWhere: (predicate: (config: any) => boolean) => {
      unpriceable = predicate;
    },
  };
}

/** What an empty cart looks like, including the delivery terms it reports. */
const EMPTY_CART = {
  lines: [],
  subtotal: 0,
  itemCount: 0,
  deliveryFee: 15000,
  freeDeliveryThreshold: 100000,
  total: 15000,
  removed: [],
};

const CONFIG = { productId: 'p1', sizeCm: 45 } as never;

describe('CartService — reading', () => {
  it('returns an empty cart for a user with nothing stored', async () => {
    const { service, products } = createService();

    await expect(service.getCart('user-1')).resolves.toEqual(EMPTY_CART);
    // No point asking the products service to price nothing.
    expect(products.send).not.toHaveBeenCalled();
  });

  it('re-prices every line through the products service', async () => {
    const { service, products } = createService([
      { lineId: 'l1', config: { productId: 'p1', sizeCm: 45 } as never, quantity: 2 },
    ]);

    const cart = await service.getCart('user-1');

    expect(products.send).toHaveBeenCalledWith('products.validate_order_items', {
      items: [{ config: { productId: 'p1', sizeCm: 45 }, quantity: 2 }],
    });
    expect(cart.subtotal).toBe(20000);
  });

  it('keeps the line ids attached to the priced rows', async () => {
    const { service } = createService([
      { lineId: 'l1', config: { productId: 'p1' } as never, quantity: 1 },
      { lineId: 'l2', config: { productId: 'p2' } as never, quantity: 1 },
    ]);

    const cart = await service.getCart('user-1');

    expect(cart.lines.map((line) => line.lineId)).toEqual(['l1', 'l2']);
  });

  it('counts items, not lines', async () => {
    const { service } = createService([
      { lineId: 'l1', config: { productId: 'p1' } as never, quantity: 2 },
      { lineId: 'l2', config: { productId: 'p2' } as never, quantity: 3 },
    ]);

    await expect(service.getCart('user-1')).resolves.toMatchObject({ itemCount: 5 });
  });

  it('exposes the raw lines for checkout', async () => {
    const lines = [{ lineId: 'l1', config: { productId: 'p1' } as never, quantity: 1 }];
    const { service } = createService(lines);

    await expect(service.getRawLines('user-1')).resolves.toEqual(lines);
  });

  it('gives an empty list of raw lines when the key expired', async () => {
    const { service } = createService();

    await expect(service.getRawLines('user-1')).resolves.toEqual([]);
  });
});

describe('CartService — lines that went out of stock', () => {
  it('drops a delisted product instead of failing the whole cart', async () => {
    const { service, delist } = createService([
      { lineId: 'l1', config: { productId: 'p1' } as never, quantity: 1 },
      { lineId: 'l2', config: { productId: 'gone' } as never, quantity: 2 },
    ]);
    delist('gone');

    const cart = await service.getCart('user-1');

    // Before this, one delisted product made every read of the cart 404 —
    // the customer could neither see the cart nor empty it for a week.
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0].lineId).toBe('l1');
    expect(cart.removed).toEqual([
      // The name travels with it: the cart names what it took out.
      { productId: 'gone', productName: 'Товар gone', reason: 'Товар недоступен' },
    ]);
  });

  it('persists the cleaned cart so the next read is quiet', async () => {
    const { service, store, delist } = createService([
      { lineId: 'l1', config: { productId: 'p1' } as never, quantity: 1 },
      { lineId: 'l2', config: { productId: 'gone' } as never, quantity: 1 },
    ]);
    delist('gone');

    await service.getCart('user-1');

    expect(store.get('cart:user-1')).toEqual([expect.objectContaining({ lineId: 'l1' })]);
  });

  it('keeps line ids aligned after a drop', async () => {
    const { service, delist } = createService([
      { lineId: 'l1', config: { productId: 'gone' } as never, quantity: 1 },
      { lineId: 'l2', config: { productId: 'p2' } as never, quantity: 1 },
      { lineId: 'l3', config: { productId: 'p3' } as never, quantity: 1 },
    ]);
    delist('gone');

    const cart = await service.getCart('user-1');

    expect(cart.lines.map((line) => line.lineId)).toEqual(['l2', 'l3']);
  });

  it('counts only the surviving lines', async () => {
    const { service, delist } = createService([
      { lineId: 'l1', config: { productId: 'p1' } as never, quantity: 2 },
      { lineId: 'l2', config: { productId: 'gone' } as never, quantity: 5 },
    ]);
    delist('gone');

    await expect(service.getCart('user-1')).resolves.toMatchObject({ itemCount: 2 });
  });

  it('does not rewrite the cart when nothing was dropped', async () => {
    const { service, cache } = createService([
      { lineId: 'l1', config: { productId: 'p1' } as never, quantity: 1 },
    ]);

    await service.getCart('user-1');

    expect(cache.set).not.toHaveBeenCalled();
  });
});

describe('CartService — delivery terms', () => {
  it('reports the fee so the client never hardcodes the tariff', async () => {
    const { service } = createService([{ lineId: 'l1', config: { productId: 'p1' } as never, quantity: 1 }]);

    await expect(service.getCart('user-1')).resolves.toMatchObject({
      subtotal: 10000,
      deliveryFee: 15000,
      freeDeliveryThreshold: 100000,
      total: 25000,
    });
  });

  it('delivers free once the basket reaches the threshold', async () => {
    const { service } = createService([{ lineId: 'l1', config: { productId: 'p1' } as never, quantity: 10 }]);

    await expect(service.getCart('user-1')).resolves.toMatchObject({
      subtotal: 100000,
      deliveryFee: 0,
      total: 100000,
    });
  });
});

describe('CartService — adding', () => {
  it('values the cart in a single call to the products service', async () => {
    // Adding an item used to cost two round trips: `price_pizza` to validate the
    // configuration, then `validate_order_items` to re-price the whole basket —
    // and the second already knew everything the first asked.
    const { service, products } = createService();

    await service.addItem('user-1', CONFIG, 1);

    expect(products.send).toHaveBeenCalledTimes(1);
    expect(products.send).toHaveBeenCalledWith('products.validate_order_items', expect.anything());
  });

  it('refuses an invalid configuration without storing it', async () => {
    const { service, store, products } = createService();
    products.send.mockImplementation(() => throwError(() => ({ statusCode: 400, message: 'Pizza requires a size' })));

    await expect(service.addItem('user-1', { productId: 'p1' } as never, 1)).rejects.toThrow('Pizza requires a size');
    expect(store.get('cart:user-1')).toBeUndefined();
  });

  it('refuses an unpriceable item, and leaves it out of the stored cart', async () => {
    // The pricing service answers "unavailable" rather than throwing. Without
    // this the item vanished into a cart that reported success.
    const { service, store, delist } = createService();
    delist('p1');

    await expect(service.addItem('user-1', CONFIG, 1)).rejects.toThrow('Товар недоступен');
    expect(store.get('cart:user-1')).toEqual([]);
  });

  /**
   * The refusal used to be matched on the product id, which is a different
   * question from the one being asked. A basket already holding a 30 cm
   * Pepperoni whose size has since been withdrawn reports *that* product as
   * removed — so adding a perfectly orderable 45 cm one failed, with the other
   * line's reason attached to it.
   */
  it('adds an orderable configuration even when another of the same product was dropped', async () => {
    const { service, store, delistWhere } = createService([
      { lineId: 'l1', config: { productId: 'p1', sizeCm: 30 } as never, quantity: 1 },
    ]);
    // Only the 30 cm is gone.
    delistWhere((config: any) => config.sizeCm === 30);

    const view = await service.addItem('user-1', { productId: 'p1', sizeCm: 45 } as never, 1);

    // The new line is in; the withdrawn one is reported and pruned.
    expect(store.get('cart:user-1')).toEqual([
      { lineId: expect.any(String), config: { productId: 'p1', sizeCm: 45 }, quantity: 1 },
    ]);
    expect(view.removed).toHaveLength(1);
  });

  it('still refuses when it is the added configuration that cannot be priced', async () => {
    const { service, delistWhere } = createService([
      { lineId: 'l1', config: { productId: 'p1', sizeCm: 30 } as never, quantity: 1 },
    ]);
    delistWhere((config: any) => config.sizeCm === 45);

    await expect(service.addItem('user-1', { productId: 'p1', sizeCm: 45 } as never, 1)).rejects.toThrow(
      'Товар недоступен',
    );
  });

  it('stores a new line with a generated id and a seven-day ttl', async () => {
    const { service, cache } = createService();

    await service.addItem('user-1', CONFIG, 2);

    const [key, lines, ttl] = cache.set.mock.calls[0];
    expect(key).toBe('cart:user-1');
    expect(ttl).toBe(604800);
    expect(lines).toEqual([{ lineId: expect.any(String), config: CONFIG, quantity: 2 }]);
  });

  it('merges an identical configuration into the existing line', async () => {
    const { service, store } = createService([
      { lineId: 'l1', config: { productId: 'p1', sizeCm: 45 } as never, quantity: 1 },
    ]);

    await service.addItem('user-1', { productId: 'p1', sizeCm: 45 } as never, 2);

    expect(store.get('cart:user-1')).toEqual([expect.objectContaining({ lineId: 'l1', quantity: 3 })]);
  });

  it('treats a different size as a different line', async () => {
    const { service, store } = createService([
      { lineId: 'l1', config: { productId: 'p1', sizeCm: 30 } as never, quantity: 1 },
    ]);

    await service.addItem('user-1', { productId: 'p1', sizeCm: 45 } as never, 1);

    expect(store.get('cart:user-1')).toHaveLength(2);
  });

  it('ignores ingredient order when matching lines', async () => {
    const { service, store } = createService([
      {
        lineId: 'l1',
        config: { productId: 'p1', sizeCm: 45, removedIngredientIds: ['a', 'b'] } as never,
        quantity: 1,
      },
    ]);

    await service.addItem('user-1', { productId: 'p1', sizeCm: 45, removedIngredientIds: ['b', 'a'] } as never, 1);

    expect(store.get('cart:user-1')).toHaveLength(1);
  });

  it.each([
    ['a different second half', { productId: 'p1', sizeCm: 45, secondHalfProductId: 'p9' }],
    ['a different dough', { productId: 'p1', sizeCm: 45, doughTypeId: 'd2' }],
    ['a removed ingredient', { productId: 'p1', sizeCm: 45, removedIngredientIds: ['i1'] }],
    ['a different product', { productId: 'p2', sizeCm: 45 }],
  ])('does not merge %s', async (_label, config) => {
    const { service, store } = createService([
      { lineId: 'l1', config: { productId: 'p1', sizeCm: 45 } as never, quantity: 1 },
    ]);

    await service.addItem('user-1', config as never, 1);

    expect(store.get('cart:user-1')).toHaveLength(2);
  });

  it('merges a sizeless product such as a drink', async () => {
    const { service, store } = createService([
      { lineId: 'l1', config: { productId: 'cola' } as never, quantity: 1 },
    ]);

    await service.addItem('user-1', { productId: 'cola' } as never, 2);

    expect(store.get('cart:user-1')).toEqual([expect.objectContaining({ lineId: 'l1', quantity: 3 })]);
  });

  it('merges two identical fully-specified constructor pizzas', async () => {
    const config = {
      productId: 'p1',
      secondHalfProductId: 'p2',
      sizeCm: 45,
      doughTypeId: 'd1',
      removedIngredientIds: ['i2'],
    };
    const { service, store } = createService([{ lineId: 'l1', config: config as never, quantity: 1 }]);

    await service.addItem('user-1', { ...config } as never, 1);

    expect(store.get('cart:user-1')).toEqual([expect.objectContaining({ lineId: 'l1', quantity: 2 })]);
  });

  it('caps a merged line at fifty units', async () => {
    const { service, store } = createService([
      { lineId: 'l1', config: { productId: 'p1', sizeCm: 45 } as never, quantity: 49 },
    ]);

    await service.addItem('user-1', { productId: 'p1', sizeCm: 45 } as never, 10);

    expect((store.get('cart:user-1') as CartLine[])[0].quantity).toBe(50);
  });

  it('refuses to grow past fifty distinct lines', async () => {
    const lines = Array.from({ length: 50 }, (_, index) => ({
      lineId: `l${index}`,
      config: { productId: `p${index}` } as never,
      quantity: 1,
    }));
    const { service } = createService(lines);

    await expect(service.addItem('user-1', { productId: 'new' } as never, 1)).rejects.toThrow(BadRequestException);
  });
});

describe('CartService — updating and removing', () => {
  it('sets a new quantity', async () => {
    const { service, store } = createService([
      { lineId: 'l1', config: { productId: 'p1' } as never, quantity: 1 },
    ]);

    await service.updateItem('user-1', 'l1', 4);

    expect((store.get('cart:user-1') as CartLine[])[0].quantity).toBe(4);
  });

  it('caps the quantity at fifty', async () => {
    const { service, store } = createService([
      { lineId: 'l1', config: { productId: 'p1' } as never, quantity: 1 },
    ]);

    await service.updateItem('user-1', 'l1', 999);

    expect((store.get('cart:user-1') as CartLine[])[0].quantity).toBe(50);
  });

  it.each([[0], [-3]])('removes the line when the quantity drops to %i', async (quantity) => {
    const { service, store } = createService([
      { lineId: 'l1', config: { productId: 'p1' } as never, quantity: 2 },
    ]);

    await service.updateItem('user-1', 'l1', quantity);

    expect(store.get('cart:user-1')).toEqual([]);
  });

  it('404s for a line that is not in the cart', async () => {
    const { service } = createService([{ lineId: 'l1', config: { productId: 'p1' } as never, quantity: 1 }]);

    await expect(service.updateItem('user-1', 'ghost', 2)).rejects.toThrow(NotFoundException);
  });

  it('removes one line and keeps the rest', async () => {
    const { service, store } = createService([
      { lineId: 'l1', config: { productId: 'p1' } as never, quantity: 1 },
      { lineId: 'l2', config: { productId: 'p2' } as never, quantity: 1 },
    ]);

    await service.removeItem('user-1', 'l1');

    expect(store.get('cart:user-1')).toEqual([expect.objectContaining({ lineId: 'l2' })]);
  });

  it('drops the whole key when clearing', async () => {
    const { service, cache } = createService([
      { lineId: 'l1', config: { productId: 'p1' } as never, quantity: 1 },
    ]);

    await expect(service.clear('user-1')).resolves.toEqual(EMPTY_CART);
    expect(cache.del).toHaveBeenCalledWith('cart:user-1');
  });

  it('replaces the cart wholesale when repeating an order', async () => {
    const { service, store } = createService();
    const lines = [{ lineId: 'l9', config: { productId: 'p9' } as never, quantity: 2 }];

    const cart = await service.replaceLines('user-1', lines);

    expect(store.get('cart:user-1')).toEqual(lines);
    expect(cart.itemCount).toBe(2);
  });
});

describe('CartService — isolation between users', () => {
  it('keys the cart by user id', async () => {
    const { service, cache } = createService();

    await service.getRawLines('user-42');

    expect(cache.get).toHaveBeenCalledWith('cart:user-42');
  });
});

/**
 * A visitor must be able to fill a basket and see what it costs before being
 * asked to register — that barrier is the most expensive thing on the site.
 * The prices still come from the server: a total that changes at the door is
 * worse than no total at all.
 */
describe('CartService — a guest cart', () => {
  const line = (productId: string, quantity = 1) => ({
    lineId: `line-${productId}`,
    config: { productId, sizeCm: 45 },
    quantity,
  });

  it('prices the browser cart without storing anything', async () => {
    const { service, cache } = createService();

    const cart = await service.preview([line('p1')] as never);

    expect(cart.subtotal).toBeGreaterThan(0);
    expect(cart.lines[0].lineId).toBe('line-p1');
    // No account, no key: nothing may be written.
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('answers an empty guest cart with the delivery terms', async () => {
    const { service } = createService();

    const cart = await service.preview([]);

    expect(cart).toMatchObject({ itemCount: 0, subtotal: 0, freeDeliveryThreshold: expect.any(Number) });
  });

  it('reports an unavailable line instead of silently dropping it', async () => {
    const { service, delist } = createService();
    delist('p1');

    const cart = await service.preview([line('p1')] as never);

    // The browser owns the list, so only the browser can edit it.
    expect(cart.lines).toHaveLength(0);
    expect(cart.removed).toEqual([
      { productId: 'p1', productName: 'Товар p1', reason: expect.any(String) },
    ]);
  });
});

describe('CartService — merging a guest cart at sign-in', () => {
  const guest = (productId: string, quantity = 1) => ({
    lineId: `guest-${productId}`,
    config: { productId, sizeCm: 45 },
    quantity,
  });

  it('adds the guest lines to what the account already had', async () => {
    const { service, cache } = createService([
      { lineId: 'l1', config: { productId: 'p1', sizeCm: 45 } as never, quantity: 1 },
    ]);

    await service.merge('user-1', [guest('p2')] as never);

    const saved = cache.set.mock.calls[0][1] as { config: { productId: string } }[];
    // Discarding either basket is the kind of surprise that loses the order.
    expect(saved.map((l) => l.config.productId)).toEqual(['p1', 'p2']);
  });

  it('merges an identical configuration into one line', async () => {
    const { service, cache } = createService([
      { lineId: 'l1', config: { productId: 'p1', sizeCm: 45 } as never, quantity: 1 },
    ]);

    await service.merge('user-1', [guest('p1', 2)] as never);

    const saved = cache.set.mock.calls[0][1] as { quantity: number }[];
    expect(saved).toHaveLength(1);
    expect(saved[0].quantity).toBe(3);
  });

  it('touches nothing when the guest cart is empty', async () => {
    const { service, cache } = createService();

    await service.merge('user-1', []);

    expect(cache.set).not.toHaveBeenCalled();
  });

  it('stops at the cart limit rather than evicting the account’s own lines', async () => {
    const stored = Array.from({ length: 50 }, (_, index) => ({
      lineId: `l${index}`,
      config: { productId: `stored-${index}`, sizeCm: 45 } as never,
      quantity: 1,
    }));
    const { service, cache } = createService(stored);

    await service.merge('user-1', [guest('overflow')] as never);

    const saved = cache.set.mock.calls[0][1] as unknown[];
    expect(saved).toHaveLength(50);
  });
});

describe('CartService — concurrent edits', () => {
  it('does not lose an item when two taps land together', async () => {
    // Unguarded, this was a read-modify-write on one Redis key: both calls read
    // the same list, both appended to their own copy, and the second write won.
    // One of the two pizzas was simply gone, with nothing anywhere saying so.
    const { service, store } = createService();

    await Promise.all([
      service.addItem('user-1', CONFIG, 1),
      service.addItem('user-1', { productId: 'p1', sizeCm: 40 } as never, 1),
    ]);

    expect(store.get('cart:user-1')).toHaveLength(2);
  });

  it('serialises a quantity change against a removal', async () => {
    const { service, store } = createService([
      { lineId: 'line-1', config: CONFIG as never, quantity: 1 },
      { lineId: 'line-2', config: { productId: 'p1', sizeCm: 40 } as never, quantity: 1 },
    ]);

    await Promise.all([
      service.updateItem('user-1', 'line-1', 5),
      service.removeItem('user-1', 'line-2'),
    ]);

    const lines = store.get('cart:user-1') as { lineId: string; quantity: number }[];
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ lineId: 'line-1', quantity: 5 });
  });

  it('releases the lock after a failed edit, so the cart is not wedged', async () => {
    const { service, store } = createService();

    await expect(service.updateItem('user-1', 'no-such-line', 2)).rejects.toThrow(NotFoundException);

    // The next edit must succeed rather than time out waiting on a lock nobody
    // holds.
    await expect(service.addItem('user-1', CONFIG, 1)).resolves.toMatchObject({ itemCount: 1 });
    expect(store.get('cart:user-1')).toHaveLength(1);
  });
});
