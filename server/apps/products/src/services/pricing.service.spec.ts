import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PricingService } from './pricing.service';

/**
 * The pricing engine is the one place where money is decided, so it is
 * tested against a hand-built fake Prisma client rather than a real DB —
 * these assertions describe business rules, not schema behaviour.
 */

const PEPPERONI = {
  id: 'pizza-pepperoni',
  name: 'Пепперони',
  type: 'PIZZA',
  isActive: true,
  basePrice: 0,
  imageUrl: null,
  sizes: [
    { id: 's1', sizeCm: 30, label: '30 см', price: 44000 },
    { id: 's2', sizeCm: 45, label: '45 см', price: 63000 },
  ],
  productIngredients: [
    { ingredientId: 'ing-mozzarella', ingredient: { id: 'ing-mozzarella', name: 'Моцарелла' } },
  ],
};

const MEAT = {
  id: 'pizza-meat',
  name: 'Мясная',
  type: 'PIZZA',
  isActive: true,
  basePrice: 0,
  imageUrl: null,
  sizes: [
    { id: 's3', sizeCm: 30, label: '30 см', price: 49000 },
    { id: 's4', sizeCm: 45, label: '45 см', price: 71000 },
  ],
  productIngredients: [],
};

const COLA = {
  id: 'drink-cola',
  name: 'Coca-Cola 0.5л',
  type: 'DRINK',
  isActive: true,
  basePrice: 9000,
  imageUrl: null,
  sizes: [],
  productIngredients: [],
};

const DOUGH_CHEESY = { id: 'dough-cheesy', name: 'Сырное', priceModifier: 15000 };
const BACON = { id: 'ing-bacon', name: 'Бекон', price: 11000 };

function createPrismaMock(catalog: Record<string, unknown> = {}) {
  const products: Record<string, unknown> = {
    [PEPPERONI.id]: PEPPERONI,
    [MEAT.id]: MEAT,
    [COLA.id]: COLA,
    ...catalog,
  };

  // Everything is fetched in one query per entity type, so the mock answers
  // `findMany` — the sequential per-line `findUnique` calls are gone.
  return {
    product: {
      findMany: jest.fn(({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => products[id]).filter(Boolean),
      ),
    },
    doughType: {
      findMany: jest.fn(({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.filter((id) => id === DOUGH_CHEESY.id).map(() => DOUGH_CHEESY),
      ),
    },
    ingredient: {
      findMany: jest.fn(({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.filter((id) => id === BACON.id).map(() => BACON),
      ),
    },
  };
}

describe('PricingService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let service: PricingService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new PricingService(prisma as never);
  });

  describe('pizza pricing', () => {
    it('uses the price of the selected size', async () => {
      const result = await service.priceOne({ productId: PEPPERONI.id, sizeCm: 45 }, 1);

      expect(result.unitPrice).toBe(63000);
      expect(result.sizeLabel).toBe('45 см');
    });

    it('multiplies by quantity', async () => {
      const result = await service.priceOne({ productId: PEPPERONI.id, sizeCm: 30 }, 3);

      expect(result.unitPrice).toBe(44000);
      expect(result.totalPrice).toBe(132000);
    });

    it('adds the dough modifier', async () => {
      const result = await service.priceOne(
        { productId: PEPPERONI.id, sizeCm: 30, doughTypeId: DOUGH_CHEESY.id },
        1,
      );

      expect(result.unitPrice).toBe(44000 + 15000);
      expect(result.doughTypeName).toBe('Сырное');
    });

    it('charges nothing for a topping, because none can be added', async () => {
      // Paid extras were removed — the pizzeria does not sell them. A config
      // still carrying the old field prices as the plain pizza rather than
      // being refused: week-old baskets in Redis have to stay orderable.
      const result = await service.priceOne(
        { productId: PEPPERONI.id, sizeCm: 30, addedIngredientIds: [BACON.id] } as never,
        1,
      );

      expect(result.unitPrice).toBe(44000);
    });

    it('does not discount removed recipe ingredients', async () => {
      const result = await service.priceOne(
        { productId: PEPPERONI.id, sizeCm: 30, removedIngredientIds: ['ing-mozzarella'] },
        1,
      );

      expect(result.unitPrice).toBe(44000);
      expect(result.removedIngredients).toEqual([{ id: 'ing-mozzarella', name: 'Моцарелла' }]);
    });

    it('prices a 50/50 pizza at the more expensive half', async () => {
      const result = await service.priceOne(
        { productId: PEPPERONI.id, secondHalfProductId: MEAT.id, sizeCm: 45 },
        1,
      );

      // Pepperoni 45cm = 63000, Meat 45cm = 71000 → the customer pays 71000.
      expect(result.unitPrice).toBe(71000);
      expect(result.productName).toBe('Пепперони / Мясная');
    });

    it('rejects a pizza without a size', async () => {
      await expect(service.priceOne({ productId: PEPPERONI.id }, 1)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects a size the product does not offer', async () => {
      await expect(service.priceOne({ productId: PEPPERONI.id, sizeCm: 60 }, 1)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects both halves being the same pizza', async () => {
      await expect(
        service.priceOne({ productId: PEPPERONI.id, secondHalfProductId: PEPPERONI.id, sizeCm: 30 }, 1),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects removing an ingredient that is not in the recipe', async () => {
      await expect(
        service.priceOne({ productId: PEPPERONI.id, sizeCm: 30, removedIngredientIds: ['ing-bacon'] }, 1),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('ignores an unknown added ingredient rather than refusing the line', async () => {
      // Same reason as above: the field is no longer part of the config, so
      // whatever it holds is not the customer's problem.
      await expect(
        service.priceOne(
          { productId: PEPPERONI.id, sizeCm: 30, addedIngredientIds: ['does-not-exist'] } as never,
          1,
        ),
      ).resolves.toMatchObject({ unitPrice: 44000 });
    });
  });

  describe('non-pizza products', () => {
    it('uses basePrice and ignores pizza-only options', async () => {
      const result = await service.priceOne(
        { productId: COLA.id, sizeCm: 45, doughTypeId: DOUGH_CHEESY.id },
        2,
      );

      expect(result.unitPrice).toBe(9000);
      expect(result.totalPrice).toBe(18000);
      expect(result.doughTypeName).toBeNull();
    });
  });

  describe('dough validation', () => {
    it('rejects a dough type that no longer exists', async () => {
      await expect(
        service.priceOne({ productId: PEPPERONI.id, sizeCm: 45, doughTypeId: 'dough-ghost' }, 1),
      ).rejects.toThrow(/Неизвестный вид теста/);
    });
  });

  describe('second half validation', () => {
    it('rejects a second half that does not exist', async () => {
      await expect(
        service.priceOne({ productId: PEPPERONI.id, secondHalfProductId: 'ghost', sizeCm: 45 }, 1),
      ).rejects.toThrow(/Вторая половинка должна быть доступной пиццей/);
    });

    it('rejects a delisted second half', async () => {
      const delisted = new PricingService(
        createPrismaMock({ [MEAT.id]: { ...MEAT, isActive: false } }) as never,
      );

      await expect(
        delisted.priceOne({ productId: PEPPERONI.id, secondHalfProductId: MEAT.id, sizeCm: 45 }, 1),
      ).rejects.toThrow(/Вторая половинка должна быть доступной пиццей/);
    });

    it('rejects a drink as the second half', async () => {
      await expect(
        service.priceOne({ productId: PEPPERONI.id, secondHalfProductId: COLA.id, sizeCm: 45 }, 1),
      ).rejects.toThrow(/Вторая половинка должна быть доступной пиццей/);
    });

    it('rejects a second half that does not come in the chosen size', async () => {
      const smallOnly = new PricingService(
        createPrismaMock({ [MEAT.id]: { ...MEAT, sizes: [MEAT.sizes[0]] } }) as never,
      );

      // Half a 45 cm pizza cannot be served on a 30-cm-only base.
      await expect(
        smallOnly.priceOne({ productId: PEPPERONI.id, secondHalfProductId: MEAT.id, sizeCm: 45 }, 1),
      ).rejects.toThrow(/Размер 45 см недоступен/);
    });
  });

  describe('validation', () => {
    it('rejects a missing product', async () => {
      await expect(service.priceOne({ productId: 'nope', sizeCm: 30 }, 1)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it.each([0, -1, 51])('rejects quantity %i', async (quantity) => {
      await expect(
        service.priceOne({ productId: PEPPERONI.id, sizeCm: 30 }, quantity),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('batching', () => {
    it('loads the whole cart with one query per entity type', async () => {
      await service.priceItems([
        { config: { productId: PEPPERONI.id, sizeCm: 30, doughTypeId: DOUGH_CHEESY.id }, quantity: 1 },
        { config: { productId: MEAT.id, sizeCm: 45 }, quantity: 2 },
        { config: { productId: COLA.id }, quantity: 3 },
      ]);

      // Previously this was up to four sequential queries per line, on every
      // read of the cart — and the header reads it on every page.
      expect(prisma.product.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.doughType.findMany).toHaveBeenCalledTimes(1);
      // Never: a recipe's ingredients arrive with the product, and nothing
      // looks one up by id now that there are no paid extras.
      expect(prisma.ingredient.findMany).not.toHaveBeenCalled();
    });

    it('asks only for the ids the cart actually mentions', async () => {
      await service.priceItems([{ config: { productId: PEPPERONI.id, sizeCm: 30 }, quantity: 1 }]);

      expect(prisma.product.findMany.mock.calls[0][0].where.id.in).toEqual([PEPPERONI.id]);
      // No dough in this cart — no reason to hit that table.
      expect(prisma.doughType.findMany).not.toHaveBeenCalled();
    });

    it('fetches both halves of a 50/50 pizza in the same query', async () => {
      await service.priceItems([
        { config: { productId: PEPPERONI.id, secondHalfProductId: MEAT.id, sizeCm: 45 }, quantity: 1 },
      ]);

      expect(prisma.product.findMany.mock.calls[0][0].where.id.in).toEqual([PEPPERONI.id, MEAT.id]);
    });
  });

  describe('lines that can no longer be priced', () => {
    it('reports a delisted product instead of failing the whole cart', async () => {
      const delisted = { ...MEAT, id: 'pizza-delisted', isActive: false };
      const svc = new PricingService(createPrismaMock({ [delisted.id]: delisted }) as never);

      const result = await svc.priceItems([
        { config: { productId: PEPPERONI.id, sizeCm: 30 }, quantity: 1 },
        { config: { productId: delisted.id, sizeCm: 30 }, quantity: 1 },
      ]);

      // The rest of the cart still prices; the customer can see and empty it.
      expect(result.items).toHaveLength(1);
      expect(result.subtotal).toBe(44000);
      expect(result.unavailable).toEqual([
        {
          index: 1,
          productId: delisted.id,
          // Named, so the cart can say what it took out rather than print an id.
          productName: delisted.name,
          reason: expect.stringContaining('недоступен'),
        },
      ]);
    });

    it('reports a product that disappeared entirely', async () => {
      const result = await service.priceItems([{ config: { productId: 'ghost', sizeCm: 30 }, quantity: 1 }]);

      expect(result.items).toEqual([]);
      expect(result.subtotal).toBe(0);
      // No row left to read a name off, so the reason carries the message alone.
      expect(result.unavailable[0]).toMatchObject({ index: 0, productId: 'ghost', productName: null });
    });

    it('reports a size the product no longer offers', async () => {
      const result = await service.priceItems([{ config: { productId: PEPPERONI.id, sizeCm: 60 }, quantity: 1 }]);

      expect(result.unavailable[0].reason).toMatch(/Размер 60 см недоступен/);
    });

    it('stamps every priced line with the request line it came from', async () => {
      const result = await service.priceItems([
        { config: { productId: 'ghost-a' }, quantity: 1 },
        { config: { productId: COLA.id }, quantity: 1 },
        { config: { productId: PEPPERONI.id, sizeCm: 30 }, quantity: 1 },
      ]);

      // `items` is shorter than the request, so position is not identity.
      // Callers that store the customer's configuration on an order — or
      // carry a cart line's id — read `index`, and this is what lets them.
      expect(result.items.map((item) => item.index)).toEqual([1, 2]);
      expect(result.items.map((item) => item.productId)).toEqual([COLA.id, PEPPERONI.id]);
    });

    it('numbers a whole cart from zero when nothing is dropped', async () => {
      const result = await service.priceItems([
        { config: { productId: PEPPERONI.id, sizeCm: 30 }, quantity: 1 },
        { config: { productId: COLA.id }, quantity: 1 },
      ]);

      expect(result.items.map((item) => item.index)).toEqual([0, 1]);
    });

    it('keeps the index so the caller knows which line to drop', async () => {
      const result = await service.priceItems([
        { config: { productId: 'ghost-a' }, quantity: 1 },
        { config: { productId: COLA.id }, quantity: 1 },
        { config: { productId: 'ghost-b' }, quantity: 1 },
      ]);

      expect(result.unavailable.map((u) => u.index)).toEqual([0, 2]);
      expect(result.items).toHaveLength(1);
    });

    it('still throws from priceOne — the constructor asked about this very choice', async () => {
      await expect(service.priceOne({ productId: 'ghost' }, 1)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('priceItems', () => {
    it('sums the subtotal across lines', async () => {
      const result = await service.priceItems([
        { config: { productId: PEPPERONI.id, sizeCm: 30 }, quantity: 2 }, // 88000
        { config: { productId: COLA.id }, quantity: 1 }, // 9000
      ]);

      expect(result.subtotal).toBe(97000);
      expect(result.items).toHaveLength(2);
      expect(result.unavailable).toEqual([]);
    });

    it('returns an empty result for an empty cart', async () => {
      await expect(service.priceItems([])).resolves.toEqual({ items: [], subtotal: 0, unavailable: [] });
    });
  });

  /**
   * "This product is gone" and "this request is malformed" both used to leave
   * `price` as a `BadRequestException`, and `priceItems` reported both as a
   * line the shop cannot sell. A cart with a tampered quantity was therefore
   * silently emptied of that line, and the customer was told the pizza had
   * sold out.
   */
  describe('a malformed quantity is not a menu change', () => {
    it('refuses the whole call rather than reporting the line as unavailable', async () => {
      await expect(
        service.priceItems([
          { config: { productId: PEPPERONI.id, sizeCm: 30 }, quantity: 1 },
          { config: { productId: COLA.id }, quantity: 999 },
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a quantity below one the same way', async () => {
      await expect(
        service.priceItems([{ config: { productId: COLA.id }, quantity: 0 }]),
      ).rejects.toThrow(/от 1 до 50/);
    });

    it('still reports a genuinely unsellable line rather than throwing', async () => {
      const result = await service.priceItems([
        { config: { productId: PEPPERONI.id, sizeCm: 60 }, quantity: 1 },
      ]);

      expect(result.unavailable).toHaveLength(1);
      expect(result.items).toEqual([]);
    });

    it('answers the constructor with a 400, as it always did', async () => {
      await expect(service.priceOne({ productId: COLA.id }, 999)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });
});

/**
 * `isActive` is a decision about the menu; running out of mozzarella is a
 * fact about tonight. The customer can act on the difference, so the refusals
 * have to read differently too.
 */
describe('PricingService — stopped items', () => {
  const hour = 60 * 60 * 1000;

  const pizzaWith = (fields: Record<string, unknown>) =>
    new PricingService(createPrismaMock({ [PEPPERONI.id]: { ...PEPPERONI, ...fields } }) as never);

  it('refuses to price something the kitchen has run out of', async () => {
    const service = pizzaWith({ stoppedUntil: new Date(Date.now() + hour) });

    await expect(service.priceOne({ productId: PEPPERONI.id, sizeCm: 45 }, 1)).rejects.toThrow(
      /закончилась/,
    );
  });

  it('prices it again once the stop has expired, with nothing to run', async () => {
    const service = pizzaWith({ stoppedUntil: new Date(Date.now() - hour) });

    await expect(service.priceOne({ productId: PEPPERONI.id, sizeCm: 45 }, 1)).resolves.toMatchObject({
      unitPrice: 63000,
    });
  });

  it('tells a delisted item apart from a sold-out one', async () => {
    const service = pizzaWith({ isActive: false });

    await expect(service.priceOne({ productId: PEPPERONI.id, sizeCm: 45 }, 1)).rejects.toThrow(
      /Товар недоступен/,
    );
  });

  it('refuses a sold-out second half', async () => {
    const service = new PricingService(
      createPrismaMock({ [MEAT.id]: { ...MEAT, stoppedUntil: new Date(Date.now() + hour) } }) as never,
    );

    await expect(
      service.priceOne({ productId: PEPPERONI.id, secondHalfProductId: MEAT.id, sizeCm: 45 }, 1),
    ).rejects.toThrow(/Вторая половинка должна быть доступной пиццей/);
  });

  it('drops a sold-out cart line instead of failing the whole cart', async () => {
    const service = pizzaWith({ stoppedUntil: new Date(Date.now() + hour) });

    const result = await service.priceItems([
      { config: { productId: PEPPERONI.id, sizeCm: 45 }, quantity: 1 },
    ]);

    expect(result.items).toHaveLength(0);
    expect(result.unavailable[0]).toMatchObject({ index: 0, productId: PEPPERONI.id });
  });
});
