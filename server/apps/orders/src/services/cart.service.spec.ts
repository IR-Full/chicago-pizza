import { BadRequestException, NotFoundException } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { CartService, CartLine } from './cart.service';

/* eslint-disable @typescript-eslint/no-explicit-any -- transport and cache mocks */

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
  };

  // The products service answers both the validate-cart and price-one calls.
  const send = jest.fn((pattern: string, payload: any) => {
    if (pattern === 'products.validate_order_items') {
      const items = payload.items.map((item: any, index: number) => ({
        productId: item.config.productId,
        productName: `Товар ${index + 1}`,
        unitPrice: 10000,
        quantity: item.quantity,
        totalPrice: 10000 * item.quantity,
      }));
      return of({ items, subtotal: items.reduce((sum: number, i: any) => sum + i.totalPrice, 0) });
    }
    return of({ unitPrice: 10000, totalPrice: 10000 * payload.quantity });
  });

  const products = { send } as any;

  return { service: new CartService(cache as never, products), cache, products, store };
}

const CONFIG = { productId: 'p1', sizeCm: 45 } as never;

describe('CartService — reading', () => {
  it('returns an empty cart for a user with nothing stored', async () => {
    const { service, products } = createService();

    await expect(service.getCart('user-1')).resolves.toEqual({ lines: [], subtotal: 0, itemCount: 0 });
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

describe('CartService — adding', () => {
  it('prices the configuration before storing it', async () => {
    const { service, products } = createService();

    await service.addItem('user-1', CONFIG, 1);

    expect(products.send).toHaveBeenNthCalledWith(1, 'products.price_pizza', { config: CONFIG, quantity: 1 });
  });

  it('refuses an invalid configuration without touching the cart', async () => {
    const { service, cache, products } = createService();
    products.send.mockImplementation(() => throwError(() => ({ statusCode: 400, message: 'Pizza requires a size' })));

    await expect(service.addItem('user-1', { productId: 'p1' } as never, 1)).rejects.toThrow('Pizza requires a size');
    expect(cache.set).not.toHaveBeenCalled();
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
        config: { productId: 'p1', sizeCm: 45, addedIngredientIds: ['a', 'b'] } as never,
        quantity: 1,
      },
    ]);

    await service.addItem('user-1', { productId: 'p1', sizeCm: 45, addedIngredientIds: ['b', 'a'] } as never, 1);

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
      addedIngredientIds: ['i1'],
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

    await expect(service.clear('user-1')).resolves.toEqual({ lines: [], subtotal: 0, itemCount: 0 });
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
