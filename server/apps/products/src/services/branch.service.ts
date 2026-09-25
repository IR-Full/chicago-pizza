import { Injectable, NotFoundException } from '@nestjs/common';
import { AdminAction, Prisma, PrismaService } from '@chicago-pizza/prisma';
import { AuditService, RedisCacheService } from '@chicago-pizza/common';

/** Branches change about as often as the menu does, and are read as often. */
const BRANCH_TTL_SECONDS = 300;
const CACHE_PREFIX = 'branches';

export interface PublicBranch {
  id: string;
  name: string;
  slug: string;
  address: string;
  lat: number;
  lng: number;
  phone: string;
  openingHour: number;
  closingHour: number;
}

/**
 * The places where pizza is actually made.
 *
 * Kept in the catalog domain: this is reference data about the shop, read by
 * the public site the way the menu is, and the orders service resolves a
 * branch over the same RPC channel it already uses to price a cart.
 *
 * A branch is never deleted, only deactivated — orders point at it, and a
 * closed branch still has to explain the deliveries it made.
 */
@Injectable()
export class BranchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: RedisCacheService,
    private readonly audit: AuditService,
  ) {}

  /** Every branch a customer may order from, in display order. */
  list(): Promise<PublicBranch[]> {
    return this.cache.wrap(`${CACHE_PREFIX}:active`, BRANCH_TTL_SECONDS, async () => {
      const branches = await this.prisma.branch.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      });
      return branches.map((branch) => this.serialize(branch));
    });
  }

  /**
   * One branch, for the orders service to validate a collection against.
   *
   * Refuses an inactive one: a closed kitchen must not be offered a new order
   * just because somebody kept its id in a stale tab.
   */
  async getOrderable(branchId: string): Promise<PublicBranch> {
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, isActive: true } });
    if (!branch) throw new NotFoundException('Пиццерия не найдена или закрыта');
    return this.serialize(branch);
  }

  /**
   * Which branch takes a delivery when nobody has said.
   *
   * For now the first active one, which is right while the chain is small and
   * every kitchen covers the whole city. Once delivery zones exist this is
   * where the zone's branch belongs instead — the caller does not change.
   */
  async defaultForDelivery(): Promise<PublicBranch | null> {
    const [branch] = await this.list();
    return branch ?? null;
  }

  // ── Admin ────────────────────────────────────────────────────

  async create(data: Prisma.BranchUncheckedCreateInput, actorId?: string): Promise<PublicBranch> {
    const branch = await this.prisma.branch.create({ data });

    await this.audit.record({
      action: AdminAction.BRANCH_CREATED,
      actorId: actorId ?? null,
      targetType: 'branch',
      targetId: branch.id,
      details: { name: branch.name, address: branch.address },
    });

    await this.invalidate();
    return this.serialize(branch);
  }

  async update(
    branchId: string,
    data: Prisma.BranchUncheckedUpdateInput,
    actorId?: string,
  ): Promise<PublicBranch> {
    const before = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { isActive: true, openingHour: true, closingHour: true },
    });

    const branch = await this.prisma.branch.update({ where: { id: branchId }, data });

    await this.audit.record({
      action: AdminAction.BRANCH_UPDATED,
      actorId: actorId ?? null,
      targetType: 'branch',
      targetId: branchId,
      details: {
        name: branch.name,
        activeFrom: before?.isActive ?? null,
        activeTo: branch.isActive,
        hoursFrom: before ? `${before.openingHour}-${before.closingHour}` : null,
        hoursTo: `${branch.openingHour}-${branch.closingHour}`,
      },
    });

    await this.invalidate();
    return this.serialize(branch);
  }

  /** Everything, including the closed ones — the admin list. */
  async adminList() {
    return this.prisma.branch.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  }

  private serialize(branch: {
    id: string;
    name: string;
    slug: string;
    address: string;
    lat: number;
    lng: number;
    phone: string;
    openingHour: number;
    closingHour: number;
  }): PublicBranch {
    return {
      id: branch.id,
      name: branch.name,
      slug: branch.slug,
      address: branch.address,
      lat: branch.lat,
      lng: branch.lng,
      phone: branch.phone,
      openingHour: branch.openingHour,
      closingHour: branch.closingHour,
    };
  }

  private invalidate() {
    return this.cache.delByPattern(`${CACHE_PREFIX}:*`);
  }
}
