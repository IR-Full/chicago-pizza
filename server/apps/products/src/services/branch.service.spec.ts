import { NotFoundException } from '@nestjs/common';
import { BranchService } from './branch.service';

const GAMZATOVA = {
  id: 'branch-1',
  name: 'Chicago Pizza на Гамзатова',
  slug: 'gamzatova',
  address: 'Махачкала, пр. Расула Гамзатова, 45',
  lat: null,
  lng: null,
  phone: '+7 8722 55-55-55',
  floor: '1 этаж',
  // 11:30 — 23:30 as minutes from midnight.
  openMinute: 690,
  closeMinute: 1410,
  isActive: true,
  sortOrder: 0,
};

function createService(branches = [GAMZATOVA]) {
  const prisma = {
    branch: {
      findMany: jest.fn(async () => branches),
      findFirst: jest.fn(async ({ where }: { where: { id: string; isActive?: boolean } }) =>
        branches.find(
          (branch) => branch.id === where.id && (where.isActive === undefined || branch.isActive),
        ) ?? null,
      ),
      findUnique: jest.fn(async () => branches[0] ?? null),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...GAMZATOVA, ...data })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...GAMZATOVA, ...data })),
    },
  };

  const cache = {
    wrap: jest.fn(async (_key: string, _ttl: number, factory: () => Promise<unknown>) => factory()),
    delByPattern: jest.fn(async () => undefined),
  };

  const audit = { record: jest.fn(async () => undefined) };

  return { service: new BranchService(prisma as never, cache as never, audit as never), prisma, cache, audit };
}

describe('BranchService — reading', () => {
  it('lists only the branches a customer may order from, in display order', async () => {
    const { service, prisma } = createService();

    const list = await service.list();

    expect(prisma.branch.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    expect(list[0]).toMatchObject({ slug: 'gamzatova', openMinute: 690, closeMinute: 1410 });
  });

  it('caches the list, like the menu', async () => {
    const { service, cache } = createService();

    await service.list();

    expect(cache.wrap).toHaveBeenCalledWith('branches:active', 300, expect.any(Function));
  });

  it('never exposes internal columns', async () => {
    const { service } = createService();

    const [branch] = await service.list();

    // `isActive` and `sortOrder` are our bookkeeping, not the customer's.
    expect(branch).not.toHaveProperty('isActive');
    expect(branch).not.toHaveProperty('sortOrder');
  });
});

describe('BranchService — validating a collection', () => {
  it('returns the branch with the hours the kitchen actually keeps', async () => {
    const { service } = createService();

    await expect(service.getOrderable('branch-1')).resolves.toMatchObject({
      id: 'branch-1',
      openMinute: 690,
      closeMinute: 1410,
    });
  });

  it('refuses an unknown branch', async () => {
    const { service } = createService();

    await expect(service.getOrderable('ghost')).rejects.toBeInstanceOf(NotFoundException);
  });

  /**
   * A closed kitchen must not be handed a new order just because somebody had
   * its id in a stale tab.
   */
  it('refuses a closed branch', async () => {
    const { service } = createService([{ ...GAMZATOVA, isActive: false }]);

    await expect(service.getOrderable('branch-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('BranchService — assigning a delivery', () => {
  it('assigns the first open branch while every kitchen covers the city', async () => {
    const { service } = createService();

    await expect(service.defaultForDelivery()).resolves.toMatchObject({ id: 'branch-1' });
  });

  it('answers null when the chain has nothing open', async () => {
    const { service } = createService([]);

    // The caller decides what that means; the order simply carries no branch.
    await expect(service.defaultForDelivery()).resolves.toBeNull();
  });
});

describe('BranchService — administration', () => {
  it('records who opened a branch', async () => {
    const { service, audit } = createService();

    await service.create({ ...GAMZATOVA, slug: 'new-one' } as never, 'admin-1');

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'BRANCH_CREATED', actorId: 'admin-1', targetType: 'branch' }),
    );
  });

  it('records an hours change next to the hours it replaced', async () => {
    const { service, audit } = createService();

    // To the all-night schedule: 06:00 is *before* opening, which the audit
    // line has to render as a clock reading rather than as a smaller number.
    await service.update('branch-1', { closeMinute: 360 }, 'admin-1');

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'BRANCH_UPDATED',
        details: expect.objectContaining({ hoursFrom: '11:30-23:30', hoursTo: '11:30-06:00' }),
      }),
    );
  });

  it('drops the cached list so a closure takes effect at once', async () => {
    const { service, cache } = createService();

    await service.update('branch-1', { isActive: false }, 'admin-1');

    expect(cache.delByPattern).toHaveBeenCalledWith('branches:*');
  });

  it('shows closed branches to an administrator', async () => {
    const { service, prisma } = createService();

    await service.adminList();

    // No `isActive` filter: the admin list is where a closure is undone.
    expect(prisma.branch.findMany).toHaveBeenCalledWith({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  });
});
