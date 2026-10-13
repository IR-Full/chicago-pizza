import { NotFoundException } from '@nestjs/common';
import { DeliveryZoneService } from './delivery-zone.service';

/** A small square over the centre of Makhachkala. */
const CENTRE = {
  id: 'zone-centre',
  name: 'Центр',
  branchId: 'branch-1',
  deliveryFee: 10_000,
  minOrderAmount: 0,
  sortOrder: 0,
  polygon: [
    [47.49, 42.97],
    [47.52, 42.97],
    [47.52, 42.99],
    [47.49, 42.99],
  ],
};

/** A larger square containing the centre, priced higher. */
const OUTSKIRTS = {
  id: 'zone-outskirts',
  name: 'Окраины',
  branchId: 'branch-2',
  deliveryFee: 25_000,
  minOrderAmount: 100_000,
  sortOrder: 1,
  polygon: [
    [47.4, 42.9],
    [47.6, 42.9],
    [47.6, 43.1],
    [47.4, 43.1],
  ],
};

const INSIDE_CENTRE = { lat: 42.98, lng: 47.5 };
const OUTSKIRTS_ONLY = { lat: 43.05, lng: 47.45 };
const ANOTHER_CITY = { lat: 43.6, lng: 39.7 };

function createService(zones: Record<string, unknown>[] = [CENTRE, OUTSKIRTS]) {
  const prisma = {
    deliveryZone: {
      findMany: jest.fn(async () => zones),
      findUnique: jest.fn(async () => ({ deliveryFee: 10_000, isActive: true })),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'zone-new', ...data })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...CENTRE, ...data })),
    },
  };

  const cache = {
    wrap: jest.fn(async (_key: string, _ttl: number, factory: () => Promise<unknown>) => factory()),
    del: jest.fn(async () => undefined),
  };

  const audit = { record: jest.fn(async () => undefined) };

  return {
    service: new DeliveryZoneService(prisma as never, cache as never, audit as never),
    prisma,
    cache,
    audit,
  };
}

describe('DeliveryZoneService — resolving a point', () => {
  it('names the zone the address falls in, with its own price', async () => {
    const { service } = createService();

    await expect(service.resolve(INSIDE_CENTRE.lat, INSIDE_CENTRE.lng)).resolves.toEqual({
      configured: true,
      zone: expect.objectContaining({ name: 'Центр', deliveryFee: 10_000, branchId: 'branch-1' }),
    });
  });

  /**
   * Zones overlap by design — a small expensive centre inside a large cheap
   * ring — so `sortOrder` is how the shop says which one takes precedence.
   */
  it('lets the first zone in order win an overlap', async () => {
    const { service } = createService();

    const { zone } = await service.resolve(INSIDE_CENTRE.lat, INSIDE_CENTRE.lng);

    // The point is inside both squares; the centre is listed first.
    expect(zone?.name).toBe('Центр');
  });

  it('falls through to the wider zone outside the centre', async () => {
    const { service } = createService();

    const { zone } = await service.resolve(OUTSKIRTS_ONLY.lat, OUTSKIRTS_ONLY.lng);

    expect(zone).toMatchObject({ name: 'Окраины', deliveryFee: 25_000, branchId: 'branch-2' });
  });

  it('reports no zone for an address nobody covers', async () => {
    const { service } = createService();

    // Configured, but outside everything — that is a refusal, not a tariff.
    await expect(service.resolve(ANOTHER_CITY.lat, ANOTHER_CITY.lng)).resolves.toEqual({
      configured: true,
      zone: null,
    });
  });

  /**
   * "No zones drawn" and "outside every zone" must not look the same: the
   * first keeps the flat tariff the shop has always had, the second turns the
   * customer away.
   */
  it('says the shop has no zones at all rather than refusing', async () => {
    const { service } = createService([]);

    await expect(service.resolve(INSIDE_CENTRE.lat, INSIDE_CENTRE.lng)).resolves.toEqual({
      configured: false,
      zone: null,
    });
  });

  it('skips a malformed ring instead of refusing the customer', async () => {
    const { service } = createService([{ ...CENTRE, polygon: 'not a ring' }, OUTSKIRTS]);

    // Bad data is our problem; the next zone still gets to answer.
    const { zone } = await service.resolve(INSIDE_CENTRE.lat, INSIDE_CENTRE.lng);

    expect(zone?.name).toBe('Окраины');
  });

  it('only considers zones of branches that are open', async () => {
    const { service, prisma } = createService();

    await service.resolve(INSIDE_CENTRE.lat, INSIDE_CENTRE.lng);

    expect(prisma.deliveryZone.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true, branch: { isActive: true } } }),
    );
  });

  it('caches the zone list — it is read on every checkout', async () => {
    const { service, cache } = createService();

    await service.resolve(INSIDE_CENTRE.lat, INSIDE_CENTRE.lng);

    expect(cache.wrap).toHaveBeenCalledWith('zones:active', 300, expect.any(Function));
  });
});

describe('DeliveryZoneService — administration', () => {
  it('records who drew a zone and what it charges', async () => {
    const { service, audit } = createService();

    await service.create({ ...CENTRE, id: undefined } as never, 'admin-1');

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ZONE_CREATED',
        actorId: 'admin-1',
        targetType: 'zone',
        details: expect.objectContaining({ deliveryFee: 10_000 }),
      }),
    );
  });

  it('records a price change next to the price it replaced', async () => {
    const { service, audit } = createService();

    await service.update('zone-centre', { deliveryFee: 12_000 }, 'admin-1');

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ZONE_UPDATED',
        details: expect.objectContaining({ feeFrom: 10_000, feeTo: 12_000 }),
      }),
    );
  });

  it('refuses to update a zone that is not there', async () => {
    const { service, prisma } = createService();
    prisma.deliveryZone.findUnique.mockResolvedValue(null as never);

    await expect(service.update('ghost', { deliveryFee: 1 }, 'admin-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('drops the cache so a new zone applies to the next checkout', async () => {
    const { service, cache } = createService();

    await service.create({ ...CENTRE } as never, 'admin-1');

    expect(cache.del).toHaveBeenCalledWith('zones:active');
  });
});
