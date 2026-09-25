import { Injectable, NotFoundException } from '@nestjs/common';
import { AdminAction, Prisma, PrismaService } from '@chicago-pizza/prisma';
import { asPolygon, AuditService, isPointInPolygon, RedisCacheService } from '@chicago-pizza/common';

const ZONE_TTL_SECONDS = 300;
const CACHE_KEY = 'zones:active';

/** What a resolved zone tells the orders service. */
export interface ResolvedZone {
  id: string;
  name: string;
  branchId: string;
  deliveryFee: number;
  minOrderAmount: number;
}

/**
 * The answer to "do we deliver there, and for how much".
 *
 * `configured` is separate from `zone` on purpose: "no zones are set up" and
 * "this address is outside every zone" are different facts, and only the
 * second one is a refusal. A shop that never drew a zone keeps the flat
 * tariff it has always had.
 */
export interface ZoneLookup {
  configured: boolean;
  zone: ResolvedZone | null;
}

interface StoredZone {
  id: string;
  name: string;
  branchId: string;
  deliveryFee: number;
  minOrderAmount: number;
  polygon: Prisma.JsonValue;
}

@Injectable()
export class DeliveryZoneService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: RedisCacheService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Which zone covers a point.
   *
   * Zones may overlap — a shop will draw a small expensive centre inside a
   * large cheap ring — so the first match in `sortOrder` wins, and putting the
   * tighter zone first is how the shop expresses "this one takes precedence".
   */
  async resolve(lat: number, lng: number): Promise<ZoneLookup> {
    const zones = await this.activeZones();
    if (!zones.length) return { configured: false, zone: null };

    for (const zone of zones) {
      const ring = asPolygon(zone.polygon);
      // A malformed ring is a data problem, not a reason to refuse the
      // customer: skip it and let the next zone answer.
      if (!ring) continue;

      if (isPointInPolygon([lng, lat], ring)) {
        return {
          configured: true,
          zone: {
            id: zone.id,
            name: zone.name,
            branchId: zone.branchId,
            deliveryFee: zone.deliveryFee,
            minOrderAmount: zone.minOrderAmount,
          },
        };
      }
    }

    return { configured: true, zone: null };
  }

  /** Read on every checkout, so it is cached like the rest of the catalog. */
  private activeZones(): Promise<StoredZone[]> {
    return this.cache.wrap(CACHE_KEY, ZONE_TTL_SECONDS, () =>
      this.prisma.deliveryZone.findMany({
        where: { isActive: true, branch: { isActive: true } },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          branchId: true,
          deliveryFee: true,
          minOrderAmount: true,
          polygon: true,
        },
      }),
    );
  }

  // ── Admin ────────────────────────────────────────────────────

  adminList() {
    return this.prisma.deliveryZone.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { branch: { select: { id: true, name: true } } },
    });
  }

  async create(data: Prisma.DeliveryZoneUncheckedCreateInput, actorId?: string) {
    const zone = await this.prisma.deliveryZone.create({ data });

    await this.audit.record({
      action: AdminAction.ZONE_CREATED,
      actorId: actorId ?? null,
      targetType: 'zone',
      targetId: zone.id,
      details: { name: zone.name, deliveryFee: zone.deliveryFee, branchId: zone.branchId },
    });

    await this.invalidate();
    return zone;
  }

  async update(zoneId: string, data: Prisma.DeliveryZoneUncheckedUpdateInput, actorId?: string) {
    const before = await this.prisma.deliveryZone.findUnique({
      where: { id: zoneId },
      select: { deliveryFee: true, isActive: true },
    });
    if (!before) throw new NotFoundException('Зона доставки не найдена');

    const zone = await this.prisma.deliveryZone.update({ where: { id: zoneId }, data });

    await this.audit.record({
      action: AdminAction.ZONE_UPDATED,
      actorId: actorId ?? null,
      targetType: 'zone',
      targetId: zoneId,
      details: {
        name: zone.name,
        feeFrom: before.deliveryFee,
        feeTo: zone.deliveryFee,
        activeFrom: before.isActive,
        activeTo: zone.isActive,
      },
    });

    await this.invalidate();
    return zone;
  }

  private invalidate() {
    return this.cache.del(CACHE_KEY);
  }
}
