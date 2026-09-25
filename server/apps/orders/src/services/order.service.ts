import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  AdminAction,
  DeliveryType,
  FulfillmentType,
  OrderStatus,
  PaymentMethod,
  Prisma,
  PrismaService,
  Role,
} from '@chicago-pizza/prisma';
import {
  AuditService,
  ConfiguredItemDto,
  DEFAULT_OPENING_HOURS,
  deliveryFeeFor,
  isWithinOpeningHours,
  kopecksToRubles,
  MIN_SCHEDULE_LEAD_MINUTES,
  paginate,
  PricedItem,
  PRODUCTS_PATTERNS,
  RedisCacheService,
  RMQ_EVENTS,
  rpcSend,
} from '@chicago-pizza/common';
import { CartService } from './cart.service';
import { PromocodeService } from './promocode.service';
import { LoyaltyService } from './loyalty.service';
import { PaymentService } from './payment.service';
import { CheckoutDto } from '../dto/checkout.dto';

/**
 * How long a used idempotency key is remembered. Long enough to cover a
 * customer retrying after a lost connection, short enough that Redis is not
 * storing a key per order forever.
 */
const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

/**
 * The answer to "do we deliver there, and for how much".
 *
 * `configured` and `zone` are separate facts: a shop that never drew a zone
 * keeps its flat tariff, while an address outside every drawn zone is a
 * refusal. An address with no coordinates cannot be tested at all — those
 * fall back to the flat tariff rather than being turned away, because every
 * address saved before the map existed has none.
 */
interface ZoneLookup {
  configured: boolean;
  zone: { id: string; name: string; branchId: string; deliveryFee: number; minOrderAmount: number } | null;
}

/** What the orders service needs to know about a kitchen. */
interface OrderableBranch {
  id: string;
  name: string;
  openingHour: number;
  closingHour: number;
}

/**
 * How far along an order may be and still be called off by the customer.
 *
 * The line is the oven: before it, nothing has been spent but time.
 */
const CUSTOMER_CANCELLABLE_STATUSES: OrderStatus[] = [OrderStatus.CREATED, OrderStatus.ACCEPTED];

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
    private readonly cache: RedisCacheService,
    private readonly payments: PaymentService,
    @Inject('PRODUCTS_SERVICE') private readonly products: ClientProxy,
    @Inject('NOTIFICATIONS_SERVICE') private readonly notifications: ClientProxy,
    @Inject('REALTIME_SERVICE') private readonly realtime: ClientProxy,
  ) {}

  /**
   * Publishes a domain event to everyone who acts on it: notifications writes
   * the row and sends the letter, the gateway turns it into a WebSocket push.
   *
   * Both, not one — the push used to be fired by the HTTP controller that
   * happened to trigger the change, so an order placed by the customer
   * notified nobody, and a status moved by anything other than the admin
   * panel pushed nothing at all.
   */
  private publish(event: string, payload: Record<string, unknown>): void {
    this.notifications.emit(event, payload);
    this.realtime.emit(event, payload);
  }

  /**
   * Places an order at most once per idempotency key.
   *
   * Without this, the button was the only thing standing between a customer
   * and two identical orders: a double tap on a slow connection, a retry
   * after a timeout, or a bfcache replay each ran the whole checkout again —
   * charging twice, and spending the loyalty points twice. Money-moving
   * endpoints have to be safe to repeat, because the network will repeat them
   * whether or not the UI wants it to.
   *
   * The key is claimed before any work starts, so the *second* request finds
   * it already taken rather than racing the first one to the database. A
   * failed checkout releases the key: a refusal the customer can fix (a bad
   * address, a dead promocode) must be retryable with the same key.
   */
  async checkout(userId: string, dto: CheckoutDto, idempotencyKey?: string) {
    if (!idempotencyKey) return this.placeOrder(userId, dto);

    const key = `order:idem:${userId}:${idempotencyKey}`;
    const claimed = await this.cache.setIfAbsent(key, { state: 'pending' }, IDEMPOTENCY_TTL_SECONDS);

    if (!claimed) {
      const previous = await this.cache.get<{ state: string; orderId?: string }>(key);
      // The first attempt finished: hand back what it produced.
      if (previous?.orderId) return this.getOrder(userId, previous.orderId, Role.USER);
      // It is still running. Answering 409 rather than waiting keeps the
      // second request from holding a connection open for the first one.
      throw new ConflictException('Заказ уже оформляется — подождите несколько секунд');
    }

    try {
      const order = await this.placeOrder(userId, dto);
      await this.cache.set(key, { state: 'done', orderId: order.id }, IDEMPOTENCY_TTL_SECONDS);
      return order;
    } catch (error) {
      await this.cache.del(key);
      throw error;
    }
  }

  /**
   * Which kitchen takes a delivery.
   *
   * The zone names one when the address falls in it. Without zones — or
   * without coordinates to test against them — the first open branch takes
   * it, which is right while every kitchen covers the whole city.
   */
  private async branchForDelivery(zone: { branchId: string } | null): Promise<OrderableBranch | null> {
    if (zone) {
      return rpcSend<OrderableBranch>(this.products, PRODUCTS_PATTERNS.GET_ORDERABLE_BRANCH, {
        branchId: zone.branchId,
      });
    }
    return rpcSend<OrderableBranch | null>(this.products, PRODUCTS_PATTERNS.DEFAULT_DELIVERY_BRANCH, {});
  }

  private async placeOrder(userId: string, dto: CheckoutDto) {
    // The whole verification flow — codes, hashes, attempt limits, burning
    // outstanding codes — existed without a single place that required its
    // result. `isEmailVerified` was read only to draw a badge on the profile
    // page, so anyone could sign up with a stranger's address, or one that
    // does not exist, and order to a real doorstep. This is the point where
    // the flag has to mean something: an order generates letters the customer
    // is expected to receive, and a phone number we have never checked either.
    //
    // Gating checkout rather than login is deliberate — browsing the menu and
    // filling a cart costs nothing, and losing that work to a hard block at
    // the door is how a customer leaves for good.
    const customer = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { isEmailVerified: true },
    });
    if (!customer.isEmailVerified) {
      throw new ForbiddenException('Подтвердите email — мы отправили код на вашу почту');
    }

    // Offering a payment method the shop cannot take is worse than not
    // offering it: the customer finds out at the last click.
    if (dto.paymentMethod === PaymentMethod.ONLINE && !this.payments.isEnabled) {
      throw new BadRequestException('Онлайн-оплата сейчас недоступна');
    }

    const lines = await this.cart.getRawLines(userId);
    if (!lines.length) throw new BadRequestException('Корзина пуста');

    const isPickup = dto.fulfillment === FulfillmentType.PICKUP;

    // A collection has a kitchen and no address; a delivery has an address and
    // is assigned a kitchen. Resolving both here keeps the branch's own
    // opening hours available for the scheduling check below.
    const address = isPickup
      ? null
      : await this.prisma.address.findFirst({ where: { id: dto.addressId, userId } });
    if (!isPickup && !address) throw new NotFoundException('Адрес доставки не найден');

    // Which zone the address falls in decides three things at once: whether
    // we deliver there at all, what it costs, and which kitchen takes it.
    const zoneLookup =
      !isPickup && address?.lat != null && address?.lng != null
        ? await rpcSend<ZoneLookup>(this.products, PRODUCTS_PATTERNS.RESOLVE_DELIVERY_ZONE, {
            lat: address.lat,
            lng: address.lng,
          })
        : null;

    if (zoneLookup?.configured && !zoneLookup.zone) {
      throw new BadRequestException('Мы пока не доставляем по этому адресу');
    }

    const branch = isPickup
      ? await rpcSend<OrderableBranch>(this.products, PRODUCTS_PATTERNS.GET_ORDERABLE_BRANCH, {
          branchId: dto.branchId,
        })
      : await this.branchForDelivery(zoneLookup?.zone ?? null);

    if (dto.deliveryType === DeliveryType.SCHEDULED) {
      // Checked against the kitchen that will actually cook it, not against a
      // company-wide constant — a chain exists so its branches can differ.
      this.assertDeliverableAt(dto.scheduledAt, branch);
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

    // A zone's minimum is about the drive, not about the discount, so it is
    // checked against what the food costs rather than what is finally paid.
    if (zoneLookup?.zone && subtotal < zoneLookup.zone.minOrderAmount) {
      throw new BadRequestException(
        `Минимальный заказ в зоне «${zoneLookup.zone.name}» — ${kopecksToRubles(zoneLookup.zone.minOrderAmount)} ₽`,
      );
    }

    const promo = dto.promocode ? await this.promocodes.validate(dto.promocode, subtotal, userId) : null;
    // Nobody is driving anywhere, so nobody pays for it. Within a zone the
    // zone's own price applies; outside any zone setup, the flat tariff.
    const deliveryFee = isPickup
      ? 0
      : (zoneLookup?.zone?.deliveryFee ?? deliveryFeeFor(subtotal));

    const order = await this.prisma.$transaction(async (tx) => {
      const promoDiscount = promo?.discount ?? 0;
      const spend = dto.redeemPoints
        ? await this.loyalty.redeemPoints(tx, userId, dto.redeemPoints, subtotal - promoDiscount)
        : null;

      const discount = promoDiscount + (spend?.discount ?? 0);
      const total = Math.max(0, subtotal - discount) + deliveryFee;

      const created = await tx.order.create({
        data: {
          userId,
          branchId: branch?.id ?? null,
          // Derived from the same flag the rest of this method branches on,
          // rather than echoed from the DTO: the two must not drift.
          fulfillment: isPickup ? FulfillmentType.PICKUP : FulfillmentType.DELIVERY,
          addressId: address?.id ?? null,
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

      // The points were spent before the order existed, so the ledger row had
      // nowhere to point. Linking it now is what makes the spend refundable
      // if the order is cancelled — and what lets the loyalty history say
      // which order a deduction was for.
      if (spend?.transactionId) {
        await tx.loyaltyTransaction.update({
          where: { id: spend.transactionId },
          data: { orderId: created.id },
        });
      }

      return created;
    });

    await this.cart.clear(userId);

    this.publish(RMQ_EVENTS.ORDER_CREATED, {
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
  private assertDeliverableAt(scheduledAt: string | undefined, branch: OrderableBranch | null): void {
    const when = new Date(scheduledAt ?? '');

    if (Number.isNaN(when.getTime())) {
      throw new BadRequestException('Некорректное время доставки');
    }

    if (when.getTime() < Date.now() + MIN_SCHEDULE_LEAD_MINUTES * 60 * 1000) {
      throw new BadRequestException(`Время доставки должно быть минимум через ${MIN_SCHEDULE_LEAD_MINUTES} минут`);
    }

    // Evaluated in the pizzeria's timezone, not the container's: the servers
    // run on UTC, so this check used to mean 13:00–02:00 in Makhachkala.
    const hours = branch
      ? { openingHour: branch.openingHour, closingHour: branch.closingHour }
      : DEFAULT_OPENING_HOURS;

    if (!isWithinOpeningHours(when, hours)) {
      throw new BadRequestException(
        `Работаем с ${hours.openingHour}:00 до ${hours.closingHour}:00`,
      );
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

  /**
   * Cancels an order the customer has changed their mind about.
   *
   * Only before the kitchen starts: once a pizza is in the oven the shop has
   * spent the ingredients, and "cancel" stops being a customer decision. Up
   * to that point refusing to let someone undo their own order just moves the
   * work to the phone — the shop cancels it anyway, only slower and with an
   * irritated customer on the line.
   *
   * Everything the order consumed goes back: the points that paid for it, and
   * the promocode use it booked.
   */
  async cancelByCustomer(userId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, userId } });
    if (!order) throw new NotFoundException('Заказ не найден');

    if (!CUSTOMER_CANCELLABLE_STATUSES.includes(order.status)) {
      throw new BadRequestException(
        order.status === OrderStatus.CANCELLED
          ? 'Заказ уже отменён'
          : 'Заказ уже готовится — отмените его через поддержку',
      );
    }

    const cancelled = await this.prisma.$transaction(async (tx) => {
      // Conditional, like every other transition: the kitchen may have
      // accepted the order in the time this request took to arrive.
      const { count } = await tx.order.updateMany({
        where: { id: orderId, status: { in: CUSTOMER_CANCELLABLE_STATUSES } },
        data: { status: OrderStatus.CANCELLED },
      });
      if (count === 0) throw new BadRequestException('Заказ уже готовится — отмените его через поддержку');

      await tx.orderStatusHistory.create({
        data: { orderId, status: OrderStatus.CANCELLED, changedById: userId },
      });

      await this.loyalty.refundForCancelledOrder(tx, userId, orderId);
      if (order.promocodeId) await this.promocodes.release(tx, order.promocodeId, orderId);

      return tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { items: true, statusHistory: { orderBy: { changedAt: 'asc' } } },
      });
    });

    // The customer is the actor here, and a cancelled order they later
    // dispute is otherwise a status with no author.
    await this.audit.record({
      action: AdminAction.ORDER_STATUS_CHANGED,
      actorId: userId,
      targetType: 'order',
      targetId: orderId,
      details: { from: order.status, to: OrderStatus.CANCELLED, by: 'customer' },
    });

    this.publish(RMQ_EVENTS.ORDER_STATUS_CHANGED, {
      orderId,
      userId,
      status: OrderStatus.CANCELLED,
      total: cancelled.total,
      updatedAt: cancelled.updatedAt,
    });

    return cancelled;
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

  /**
   * Which products this customer has ordered before.
   *
   * The catalog needs it to stop recommending things someone already buys
   * every week, and used to read `order_items` straight out of the shared
   * database. Same rows, same answer — but a query written in another
   * service's codebase is a dependency nobody can see: rename a column here
   * and the catalog breaks, with nothing in this repository pointing at it.
   * Asking over the wire makes the dependency an interface.
   */
  async listOrderedProductIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.orderItem.findMany({
      where: { order: { userId } },
      select: { productId: true },
      distinct: ['productId'],
    });

    return rows.map((row) => row.productId);
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
    branchId?: string;
    liveOnly?: boolean;
    actorId: string;
    actorRole: Role;
  }) {
    const where: Prisma.OrderWhereInput = {
      ...(params.status ? { status: params.status } : {}),
      // The kitchen screen asks for one branch, and for what is still in play:
      // a board carrying yesterday's delivered orders is a board nobody reads.
      ...(params.branchId ? { branchId: params.branchId } : {}),
      ...(params.liveOnly && !params.status ? { status: { notIn: TERMINAL_STATUSES } } : {}),
      // An order awaiting an online payment is not the kitchen's problem yet:
      // cooking it before the money arrives is how a shop gives pizza away.
      ...(params.liveOnly
        ? {
            NOT: {
              paymentMethod: PaymentMethod.ONLINE,
              payment: { is: { status: { not: 'SUCCEEDED' } } },
            },
          }
        : {}),
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

  /**
   * Which staff member may make which transition.
   *
   * `staffMayRead` spells access out per role, and the write path did not:
   * it took the actor's id purely to stamp the history row, so any courier
   * could cancel a stranger's order, snatch a delivery already assigned to a
   * colleague, or mark one delivered — the last of which also pays out
   * cashback and settles a referral. An authorisation model that exists on
   * the read side and not on the write side is not an authorisation model.
   */
  private staffMayWrite(
    order: { courierId?: string | null },
    nextStatus: OrderStatus,
    actor: { id: string; role: Role },
  ): boolean {
    switch (actor.role) {
      case Role.ADMIN:
        return true;
      case Role.COURIER:
        // The state machine already fixes *where* these transitions may
        // happen from; what is left to decide is whose delivery it is.
        if (nextStatus === OrderStatus.ON_DELIVERY) {
          return !order.courierId || order.courierId === actor.id;
        }
        if (nextStatus === OrderStatus.DELIVERED) return order.courierId === actor.id;
        // Cancelling is a refund decision, not a delivery one.
        return false;
      default:
        return false;
    }
  }

  async updateStatus(params: {
    orderId: string;
    status: OrderStatus;
    actorId: string;
    actorRole: Role;
  }) {
    const { orderId, status: nextStatus, actorId: changedById, actorRole } = params;

    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Заказ не найден');

    if (!ALLOWED_TRANSITIONS[order.status].includes(nextStatus)) {
      throw new BadRequestException(`Нельзя перевести заказ из «${order.status}» в «${nextStatus}»`);
    }

    if (!this.staffMayWrite(order, nextStatus, { id: changedById, role: actorRole })) {
      throw new ForbiddenException('Недостаточно прав для этого изменения статуса');
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

      // Loyalty and referral rewards settle only once the order is actually
      // delivered. Cashback is earned on what the customer paid for food —
      // not on the delivery fee, and not on the part of the bill that points
      // and promocodes already covered.
      if (nextStatus === OrderStatus.DELIVERED) {
        await this.loyalty.awardForOrder(tx, order.userId, orderId, result.subtotal - result.discount);
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

    this.publish(RMQ_EVENTS.ORDER_STATUS_CHANGED, {
      orderId,
      userId: order.userId,
      status: nextStatus,
      total: updated.total,
      // The customer's screen shows when the order last moved.
      updatedAt: updated.updatedAt,
    });

    return updated;
  }
}
