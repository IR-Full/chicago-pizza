import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { DeliveryType, OrderStatus, Prisma, PrismaService, Role } from '@chicago-pizza/prisma';
import { ConfiguredItemDto, PricedItem, PRODUCTS_PATTERNS, RMQ_EVENTS, rpcSend } from '@chicago-pizza/common';
import { CartService } from './cart.service';
import { PromocodeService } from './promocode.service';
import { LoyaltyService } from './loyalty.service';
import { CheckoutDto } from '../dto/checkout.dto';

const DELIVERY_FEE = 15000; // 150 ₽
const FREE_DELIVERY_THRESHOLD = 100000; // free above 1000 ₽

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
    @Inject('PRODUCTS_SERVICE') private readonly products: ClientProxy,
    @Inject('NOTIFICATIONS_SERVICE') private readonly notifications: ClientProxy,
  ) {}

  async checkout(userId: string, dto: CheckoutDto) {
    const lines = await this.cart.getRawLines(userId);
    if (!lines.length) throw new BadRequestException('Корзина пуста');

    const address = await this.prisma.address.findFirst({ where: { id: dto.addressId, userId } });
    if (!address) throw new NotFoundException('Адрес доставки не найден');

    if (dto.deliveryType === DeliveryType.SCHEDULED) {
      const when = new Date(dto.scheduledAt!);
      if (Number.isNaN(when.getTime()) || when.getTime() < Date.now() + 30 * 60 * 1000) {
        throw new BadRequestException('Время доставки должно быть минимум через 30 минут');
      }
    }

    // Authoritative re-pricing: the client's numbers are never trusted.
    const items: ConfiguredItemDto[] = lines.map((l) => ({ config: l.config, quantity: l.quantity }));
    const priced = await rpcSend<{ items: PricedItem[]; subtotal: number }>(
      this.products,
      PRODUCTS_PATTERNS.VALIDATE_ORDER_ITEMS,
      { items },
    );

    const subtotal = priced.subtotal;
    const promo = dto.promocode ? await this.promocodes.validate(dto.promocode, subtotal) : null;
    const deliveryFee = subtotal >= FREE_DELIVERY_THRESHOLD ? 0 : DELIVERY_FEE;

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

      if (promo) await tx.promocode.update({ where: { id: promo.promocodeId }, data: { usedCount: { increment: 1 } } });

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

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
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

    const isStaff = role === Role.ADMIN || role === Role.COURIER || role === Role.SUPPORT;
    if (order.userId !== userId && !isStaff) throw new ForbiddenException('Нет доступа к этому заказу');

    return order;
  }

  /** Re-adds a past order's items to the cart, skipping items no longer available. */
  async repeatOrder(userId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Заказ не найден');

    const lines = order.items
      .filter((item) => item.config !== null)
      .map((item) => ({
        lineId: item.id,
        config: item.config as unknown as ConfiguredItemDto['config'],
        quantity: item.quantity,
      }));

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

  // ── Staff operations ─────────────────────────────────────────

  async adminListOrders(params: { page: number; limit: number; status?: OrderStatus }) {
    const where = params.status ? { status: params.status } : {};
    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: {
          items: true,
          address: true,
          user: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      this.prisma.order.count({ where }),
    ]);

    return { items, total, page: params.page, limit: params.limit, totalPages: Math.ceil(total / params.limit) };
  }

  async updateStatus(orderId: string, nextStatus: OrderStatus, changedById: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Заказ не найден');

    if (!ALLOWED_TRANSITIONS[order.status].includes(nextStatus)) {
      throw new BadRequestException(`Нельзя перевести заказ из «${order.status}» в «${nextStatus}»`);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.order.update({
        where: { id: orderId },
        data: { status: nextStatus, statusHistory: { create: { status: nextStatus, changedById } } },
        include: { items: true, statusHistory: { orderBy: { changedAt: 'asc' } } },
      });

      // Loyalty and referral rewards settle only once the order is actually delivered.
      if (nextStatus === OrderStatus.DELIVERED) {
        await this.loyalty.awardForOrder(tx, order.userId, orderId, result.total);
        await this.loyalty.settleReferral(tx, order.userId);
      }

      return result;
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
