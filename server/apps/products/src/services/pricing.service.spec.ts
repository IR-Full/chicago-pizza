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

function createPrismaMock() {
  const products: Record<string, unknown> = {
    [PEPPERONI.id]: PEPPERONI,
    [MEAT.id]: MEAT,
    [COLA.id]: COLA,
  };

  return {
    product: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) => products[where.id] ?? null),
    },
    doughType: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        where.id === DOUGH_CHEESY.id ? DOUGH_CHEESY : null,
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

    it('charges each added ingredient', async () => {
      const result = await service.priceOne(
        { productId: PEPPERONI.id, sizeCm: 30, addedIngredientIds: [BACON.id] },
        1,
      );

      expect(result.unitPrice).toBe(44000 + 11000);
      expect(result.addedIngredients).toHaveLength(1);
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

    it('rejects an unknown added ingredient', async () => {
      await expect(
        service.priceOne({ productId: PEPPERONI.id, sizeCm: 30, addedIngredientIds: ['does-not-exist'] }, 1),
      ).rejects.toBeInstanceOf(BadRequestException);
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
      ).rejects.toThrow(/Unknown dough type/);
    });
  });

  describe('second half validation', () => {
    it('rejects a second half that does not exist', async () => {
      await expect(
        service.priceOne({ productId: PEPPERONI.id, secondHalfProductId: 'ghost', sizeCm: 45 }, 1),
      ).rejects.toThrow(/Second half must be an available pizza/);
    });

    it('rejects a delisted second half', async () => {
      prisma.product.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
        where.id === PEPPERONI.id ? PEPPERONI : { ...MEAT, isActive: false },
      );

      await expect(
        service.priceOne({ productId: PEPPERONI.id, secondHalfProductId: MEAT.id, sizeCm: 45 }, 1),
      ).rejects.toThrow(/Second half must be an available pizza/);
    });

    it('rejects a drink as the second half', async () => {
      await expect(
        service.priceOne({ productId: PEPPERONI.id, secondHalfProductId: COLA.id, sizeCm: 45 }, 1),
      ).rejects.toThrow(/Second half must be an available pizza/);
    });

    it('rejects a second half that does not come in the chosen size', async () => {
      prisma.product.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
        where.id === PEPPERONI.id ? PEPPERONI : { ...MEAT, sizes: [MEAT.sizes[0]] },
      );

      // Half a 45 cm pizza cannot be served on a 30-cm-only base.
      await expect(
        service.priceOne({ productId: PEPPERONI.id, secondHalfProductId: MEAT.id, sizeCm: 45 }, 1),
      ).rejects.toThrow(/45 cm is not available/);
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

  describe('priceItems', () => {
    it('sums the subtotal across lines', async () => {
      const result = await service.priceItems([
        { config: { productId: PEPPERONI.id, sizeCm: 30 }, quantity: 2 }, // 88000
        { config: { productId: COLA.id }, quantity: 1 }, // 9000
      ]);

      expect(result.subtotal).toBe(97000);
      expect(result.items).toHaveLength(2);
    });

    it('returns an empty result for an empty cart', async () => {
      await expect(service.priceItems([])).resolves.toEqual({ items: [], subtotal: 0 });
    });
  });
});
