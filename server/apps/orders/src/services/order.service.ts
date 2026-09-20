import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { AdminAction, DeliveryType, OrderStatus, Prisma, PrismaService, Role } from '@chicago-pizza/prisma';
import {
  AuditService,
  CLOSING_HOUR,
  ConfiguredItemDto,
  deliveryFeeFor,
  isWithinOpeningHours,
  MIN_SCHEDULE_LEAD_MINUTES,
  OPENING_HOUR,
  paginate,
  PricedItem,
  PRODUCTS_PATTERNS,
  RMQ_EVENTS,
  rpcSend,
} from '@chicago-pizza/common';
import { CartService } from './cart.service';
import { PromocodeService } from './promocode.service';
import { LoyaltyService } from './loyalty.service';
import { CheckoutDto } from '../dto/checkout.dto';

/** An order in one of these is finished; nothing more happens to it. */
const TERMINAL_STATUSES: OrderStatus[] = [OrderStatus.DELIVERED, OrderStatus.CANCELLED];

/** Which status a given status may move to. Prevents illegal jumps like DELIVERED → PREPARING. */
const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  CREATED: [OrderStatus.ACCEPTED, OrderStatus.CANCELLED],
  ACCEPTED: [OrderStatus.PREPARING, OrderStatus.CANCELLED],
  PREPARING: [OrderStatus.ON_DELIVERY, OrderStatus.CANCELLED],
  ON_DELIVERY: [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
  DELIVERED: [],
  CANCELLED: [],
};

@Injectable()
export class OrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cart: CartService,
    private readonly promocodes: PromocodeService,
    private readonly loyalty: LoyaltyService,
    private readonly audit: AuditService,
    @Inject('PRODUCTS_SERVICE') private readonly products: ClientProxy,
    @Inject('NOTIFICATIONS_SERVICE') private readonly notifications: ClientProxy,
  ) {}

  async checkout(userId: string, dto: CheckoutDto) {
    const lines = await this.cart.getRawLines(userId);
    if (!lines.length) throw new BadRequestException('Корзина пуста');

    const address = await this.prisma.address.findFirst({ where: { id: dto.addressId, userId } });
    if (!address) throw new NotFoundException('Адрес доставки не найден');

    if (dto.deliveryType === DeliveryType.SCHEDULED) {
      this.assertDeliverableAt(dto.scheduledAt);
    }

    // Authoritative re-pricing: the client's numbers are never trusted.
    const items: ConfiguredItemDto[] = lines.map((l) => ({ config: l.config, quantity: l.quantity }));
    const priced = await rpcSend<{
      items: PricedItem[];
      subtotal: number;
      unavailable: { index: number; productId: string; reason: string }[];
    }>(this.products, PRODUCTS_PATTERNS.VALIDATE_ORDER_ITEMS, { items });

    // Reading the cart drops unavailable lines, but a product can be delisted
    // between that read and this one. Refuse rather than quietly charging for
    // a different basket than the customer confirmed.
    if (priced.unavailable.length) {
      throw new BadRequestException(
        'Некоторые позиции больше недоступны — откройте корзину, мы её обновили',
      );
    }

    const subtotal = priced.subtotal;
    const promo = dto.promocode ? await this.promocodes.validate(dto.promocode, subtotal, userId) : null;
    const deliveryFee = deliveryFeeFor(subtotal);

    const order = await this.prisma.$transaction(async (tx) => {
      const promoDiscount = promo?.discount ?? 0;
      const pointsDiscount = dto.redeemPoints
        ? await this.loyalty.redeemPoints(tx, userId, dto.redeemPoints, subtotal - promoDiscount)
        : 0;

      const discount = promoDiscount + pointsDiscount;
      const total = Math.max(0, subtotal - discount) + deliveryFee;

      const created = await tx.order.create({
        data: {
          userId,
          addressId: address.id,
          deliveryType: dto.deliveryType,
          scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
          comment: dto.comment,
          promocodeId: promo?.promocodeId ?? null,
          subtotal,
          discount,
          deliveryFee,
          total,
          paymentMethod: dto.paymentMethod,
          items: {
            create: priced.items.map((item, idx) => ({
              productId: item.productId,
              productName: item.productName,
              sizeLabel: item.sizeLabel,
              doughTypeId: item.doughTypeId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              totalPrice: item.totalPrice,
              config: lines[idx].config as unknown as Prisma.InputJsonValue,
            })),
          },
          statusHistory: { create: { status: OrderStatus.CREATED, changedById: userId } },
        },
        include: { items: true, address: true },
      });

      // Booking the use conditionally keeps two simultaneous checkouts from
      // spending the last allowed use of the same code.
      if (promo) await this.promocodes.redeem(tx, promo.promocodeId, userId, created.id);

      return created;
    });

    await this.cart.clear(userId);

    this.notifications.emit(RMQ_EVENTS.ORDER_CREATED, {
      orderId: order.id,
      userId,
      total: order.total,
    });

    return this.getOrder(userId, order.id, Role.USER);
  }

  /**
   * A scheduled delivery has to be far enough ahead for the kitchen to cook
   * it *and* fall inside opening hours — the form used to accept 04:00, which
   * nobody would have delivered.
   */
  private assertDeliverableAt(scheduledAt: string | undefined): void {
    const when = new Date(scheduledAt ?? '');

    if (Number.isNaN(when.getTime())) {
      throw new BadRequestException('Некорректное время доставки');
    }

    if (when.getTime() < Date.now() + MIN_SCHEDULE_LEAD_MINUTES * 60 * 1000) {
      throw new BadRequestException(`Время доставки должно быть минимум через ${MIN_SCHEDULE_LEAD_MINUTES} минут`);
    }

    // Evaluated in the pizzeria's timezone, not the container's: the servers
    // run on UTC, so this check used to mean 13:00–02:00 in Makhachkala.
    if (!isWithinOpeningHours(when)) {
      throw new BadRequestException(`Доставка работает с ${OPENING_HOUR}:00 до ${CLOSING_HOUR}:00`);
    }
  }

  async listOrders(userId: string, page = 1, limit = 20) {
    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where: { userId },
        include: { items: true, address: true, review: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.order.count({ where: { userId } }),
    ]);

    return paginate(items, total, { page, limit });
  }

  async getOrder(userId: string, orderId: string, role: Role) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        address: true,
        statusHistory: { orderBy: { changedAt: 'asc' } },
        review: true,
        promocode: { select: { code: true } },
      },
    });
    if (!order) throw new NotFoundException('Заказ не найден');

    if (order.userId !== userId && !this.staffMayRead(order, role, userId)) {
      throw new ForbiddenException('Нет доступа к этому заказу');
    }

    return order;
  }

  /**
   * Which staff member may open which order.
   *
   * "Any staff role may read any order" was one condition doing the work of
   * three. A courier needs the address and phone of the order in their hands,
   * not of every order the shop has ever taken; once it is delivered they do
   * not need it at all. Support needs to answer questions, which is a
   * different shape again. Least privilege has to be spelled out per role or
   * it collapses back into "staff".
   */
  private staffMayRead(
    order: { courierId?: string | null; status: OrderStatus },
    role: Role,
    userId: string,
  ): boolean {
    switch (role) {
      case Role.ADMIN:
        return true;
      case Role.COURIER:
        // Their own delivery, or one still unassigned and waiting to be taken.
        return order.courierId === userId || (!order.courierId && !TERMINAL_STATUSES.includes(order.status));
      case Role.SUPPORT:
        return true;
      default:
        return false;
    }
  }

  /**
   * Re-adds a past order's items to the cart. Items whose product has since
   * been delisted are dropped — putting them back used to poison the cart,
   * because every read of it then failed on the unavailable product.
   */
  async repeatOrder(userId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Заказ не найден');

    const stored = order.items
      .filter((item) => item.config !== null)
      .map((item) => ({
        lineId: item.id,
        config: item.config as unknown as ConfiguredItemDto['config'],
        quantity: item.quantity,
      }));

    if (!stored.length) throw new BadRequestException('Нечего повторить: состав заказа не сохранён');

    // Ask the products service which of them can still be ordered.
    const priced = await rpcSend<{ unavailable: { index: number }[] }>(
      this.products,
      PRODUCTS_PATTERNS.VALIDATE_ORDER_ITEMS,
      { items: stored.map((line) => ({ config: line.config, quantity: line.quantity })) },
    );

    const dropped = new Set(priced.unavailable.map((u) => u.index));
    const lines = stored.filter((_, index) => !dropped.has(index));

    if (!lines.length) throw new BadRequestException('Нечего повторить: товары больше не доступны');

    return this.cart.replaceLines(userId, lines);
  }

  async submitReview(userId: string, orderId: string, rating: number, comment?: string) {
    if (rating < 1 || rating > 5) throw new BadRequestException('Оценка должна быть от 1 до 5');

    const order = await this.prisma.order.findFirst({ where: { id: orderId, userId } });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (order.status !== OrderStatus.DELIVERED) {
      throw new BadRequestException('Оценить можно только доставленный заказ');
    }

    return this.prisma.review.upsert({
      where: { orderId },
      update: { rating, comment },
      create: { orderId, userId, rating, comment },
    });
  }

  /**
   * Recent reviews with something to say, for the home page. A review rates a
   * whole order, so it is shown with the items that order contained rather
   * than pinned to one product.
   */
  async listRecentReviews(limit = 3) {
    const reviews = await this.prisma.review.findMany({
      where: { comment: { not: null }, rating: { gte: 4 } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 20),
      include: {
        user: { select: { firstName: true } },
        order: { select: { items: { select: { productName: true } } } },
      },
    });

    return reviews.map((review) => ({
      id: review.id,
      rating: review.rating,
      comment: review.comment,
      createdAt: review.createdAt,
      authorName: review.user.firstName,
      items: review.order.items.map((item) => item.productName),
    }));
  }

  // ── Personal data ────────────────────────────────────────────

  /**
   * This domain's share of a data-export request: what the customer ordered,
   * what it cost and what the loyalty ledger did about it. Internal keys are
   * left out — an export is a copy of a person's data, not a database dump.
   */
  async exportForUser(userId: string) {
    const [orders, loyalty, reviews] = await Promise.all([
      this.prisma.order.findMany({
        where: { userId },
        include: { items: true, address: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.loyaltyTransaction.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.review.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
    ]);

    return {
      orders: orders.map((order) => ({
        number: order.id,
        placedAt: order.createdAt,
        status: order.status,
        deliveryType: order.deliveryType,
        paymentMethod: order.paymentMethod,
        comment: order.comment,
        subtotal: order.subtotal,
        discount: order.discount,
        deliveryFee: order.deliveryFee,
        total: order.total,
        address: order.address
          ? {
              city: order.address.city,
              street: order.address.street,
              house: order.address.house,
              apartment: order.address.apartment,
            }
          : null,
        items: order.items.map((item) => ({
          name: item.productName,
          size: item.sizeLabel,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
        })),
      })),
      loyalty: loyalty.map(({ points, type, createdAt }) => ({ points, type, createdAt })),
      reviews: reviews.map(({ rating, comment, createdAt }) => ({ rating, comment, createdAt })),
    };
  }

  /**
   * Erasure, this domain's half.
   *
   * Orders stay: they are accounting records with their own retention, and
   * the account row they point at has had every identifying field overwritten
   * by the time this runs. What goes is the free text the customer wrote —
   * a delivery comment or a review can name a person, a building, a habit.
   */
  async anonymizeUser(userId: string): Promise<{ success: true }> {
    await this.prisma.$transaction([
      this.prisma.order.updateMany({ where: { userId }, data: { comment: null } }),
      this.prisma.review.updateMany({ where: { userId }, data: { comment: null } }),
    ]);
    return { success: true };
  }

  // ── Staff operations ─────────────────────────────────────────

  /**
   * The staff order board.
   *
   * This used to answer the same list to every staff role, so a courier's
   * dashboard held the name, phone, email and flat number of every customer
   * the shop has ever had — one compromised courier account away from being
   * the whole customer database. A courier sees the deliveries that are
   * theirs to make, and nothing else; the contact details follow that.
   */
  async adminListOrders(params: {
    page: number;
    limit: number;
    status?: OrderStatus;
    actorId: string;
    actorRole: Role;
  }) {
    const where: Prisma.OrderWhereInput = {
      ...(params.status ? { status: params.status } : {}),
      ...(params.actorRole === Role.COURIER
        ? {
            OR: [{ courierId: params.actorId }, { courierId: null }],
            status: params.status ?? { notIn: TERMINAL_STATUSES },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: {
          items: true,
          address: true,
          // A courier needs to reach the customer at the door; an email
          // address does nothing for that, so it is not in their copy.
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              phone: true,
              email: params.actorRole !== Role.COURIER,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      this.prisma.order.count({ where }),
    ]);

    return paginate(items, total, params);
  }

  async updateStatus(orderId: string, nextStatus: OrderStatus, changedById: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Заказ не найден');

    if (!ALLOWED_TRANSITIONS[order.status].includes(nextStatus)) {
      throw new BadRequestException(`Нельзя перевести заказ из «${order.status}» в «${nextStatus}»`);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // Guarding on the status we validated against makes the transition
      // atomic: two couriers tapping "delivered" at once cannot both award
      // loyalty points for the same order.
      const { count } = await tx.order.updateMany({
        where: { id: orderId, status: order.status },
        data: {
          status: nextStatus,
          // Whoever moves an order out for delivery owns it from then on.
          ...(nextStatus === OrderStatus.ON_DELIVERY && !order.courierId ? { courierId: changedById } : {}),
        },
      });

      if (count === 0) throw new BadRequestException('Статус заказа уже изменён — обновите страницу');

      await tx.orderStatusHistory.create({ data: { orderId, status: nextStatus, changedById } });

      const result = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { items: true, statusHistory: { orderBy: { changedAt: 'asc' } } },
      });

      // Loyalty and referral rewards settle only once the order is actually delivered.
      if (nextStatus === OrderStatus.DELIVERED) {
        await this.loyalty.awardForOrder(tx, order.userId, orderId, result.total);
        await this.loyalty.settleReferral(tx, order.userId);
      }

      return result;
    });

    // Who moved the order, and from what. A cancelled order a customer
    // disputes is otherwise a status with no author.
    await this.audit.record({
      action: AdminAction.ORDER_STATUS_CHANGED,
      actorId: changedById,
      targetType: 'order',
      targetId: orderId,
      details: { from: order.status, to: nextStatus },
    });

    this.notifications.emit(RMQ_EVENTS.ORDER_STATUS_CHANGED, {
      orderId,
      userId: order.userId,
      status: nextStatus,
      total: updated.total,
    });

    return updated;
  }
}
