import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  AdminAction,
  DeliveryType,
  FulfillmentType,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  PrismaService,
  Role,
} from '@chicago-pizza/prisma';
import {
  AuditService,
  ConfiguredItemDto,
  formatOpeningMinute,
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
import { recordOrderEvent } from './order-events';
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

/**
 * How long an online order may go unpaid before it is cancelled.
 *
 * Long enough that someone who went to find their card still has an order to
 * come back to; short enough that the points and the promocode use it is
 * holding are returned the same evening.
 */
const UNPAID_ORDER_TTL_MINUTES = 60;

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
  /** Minutes from midnight; `closeMinute <= openMinute` means past midnight. */
  openMinute: number;
  closeMinute: number;
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
  private readonly logger = new Logger(OrderService.name);

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
   * Hands back everything a cancelled order had consumed but not used.
   *
   * Shared by both cancellation paths on purpose. They were written separately
   * and drifted: the customer's own cancellation refunded points and released
   * the promocode, the staff one did neither, and which of the two ran decided
   * whether a customer got their points back. A rule about what cancelling
   * means belongs in one place.
   */
  private async releaseConsumables(
    tx: Prisma.TransactionClient,
    userId: string,
    orderId: string,
    promocodeId: string | null,
  ): Promise<void> {
    await this.loyalty.refundForCancelledOrder(tx, userId, orderId);
    if (promocodeId) await this.promocodes.release(tx, promocodeId, orderId);
  }

  /**
   * Returns the money, if any was taken.
   *
   * Deliberately does not fail the cancellation: by the time this runs the
   * order is already off, and throwing here would answer the customer with an
   * error about an order that is, in fact, cancelled — and tempt them into
   * pressing cancel again.
   *
   * What it does instead is leave the evidence where it can be acted on. A
   * payment still marked `SUCCEEDED` under an order marked `CANCELLED` is
   * precisely the list of refunds the shop owes, and it is one query away.
   */
  private async refundMoney(orderId: string): Promise<void> {
    try {
      await this.payments.refundForCancelledOrder(orderId);
    } catch (error) {
      this.logger.error(
        `Refund failed for cancelled order ${orderId} — the payment is still SUCCEEDED and owes the customer`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Publishes a domain event to everyone who acts on it: notifications writes
   * the row and sends the letter, the gateway turns it into a WebSocket push.
   *
   * Both, not one — the push used to be fired by the HTTP controller that
   * happened to trigger the change, so an order placed by the customer
   * notified nobody, and a status moved by anything other than the admin
   * panel pushed nothing at all.
   */
  /**
   * The checkout key is stored on the order itself, with a database unique
   * constraint and an advisory transaction lock. Redis loss or post-commit
   * cleanup failure cannot forget a completed checkout.
   */
  async checkout(userId: string, dto: CheckoutDto, idempotencyKey?: string) {
    if (process.env.DEPLOYMENT_MODE === 'public' && !idempotencyKey)
      throw new BadRequestException('Idempotency-Key обязателен');
    if (idempotencyKey) {
      const existing = await this.prisma.order.findFirst({ where: { userId, idempotencyKey } });
      if (existing) return this.getOrder(userId, existing.id, Role.USER);
    }
    try {
      return await this.placeOrder(userId, dto, idempotencyKey);
    } catch (error) {
      // A concurrent submission may have committed and cleared the cart while
      // this request was validating it. Reuse that result even on this path.
      if (idempotencyKey) {
        const existing = await this.prisma.order.findFirst({ where: { userId, idempotencyKey } });
        if (existing) return this.getOrder(userId, existing.id, Role.USER);
      }
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

  private async placeOrder(userId: string, dto: CheckoutDto, idempotencyKey?: string) {
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
      : await this.prisma.address.findFirst({ where: { id: dto.addressId, userId, archivedAt: null } });
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

    // Every order needs a kitchen, and a delivery used to be allowed to go
    // without one: `DEFAULT_DELIVERY_BRANCH` answers null when no branch is
    // active, and the order was then written with `branchId: null`. Nothing
    // rejected it and nothing could cook it — the kitchen board filters by
    // branch, so the order was invisible to every screen that would have
    // noticed. Refusing is the honest answer: there is nobody to make it.
    if (!branch) {
      throw new BadRequestException('Сейчас нет открытой пиццерии, которая может принять заказ');
    }

    // Opening hours apply to both kinds of order, which is new: this check hung
    // off `SCHEDULED` alone, so "as soon as possible" skipped it entirely and
    // the form happily took an order at four in the morning. A scheduled slot
    // is checked at the slot; an ASAP order is checked now, because now is
    // when the kitchen would have to start it.
    if (dto.deliveryType === DeliveryType.SCHEDULED) {
      // Checked against the kitchen that will actually cook it, not against a
      // company-wide constant — a chain exists so its branches can differ.
      this.assertDeliverableAt(dto.scheduledAt, branch);
    } else {
      this.assertOpenNow(branch);
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
      throw new BadRequestException('Некоторые позиции больше недоступны — откройте корзину, мы её обновили');
    }

    // Every priced line must name a cart line that exists. Nothing should be
    // able to violate this; if something does, refusing beats charging for a
    // basket nobody assembled.
    const lineByIndex = (index: number) => {
      const line = lines[index];
      if (!line) throw new BadRequestException('Не удалось собрать заказ — откройте корзину заново');
      return line;
    };

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
    const deliveryFee = isPickup ? 0 : (zoneLookup?.zone?.deliveryFee ?? deliveryFeeFor(subtotal));

    const order = await this.prisma.$transaction(async (tx) => {
      if (idempotencyKey) {
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${userId + ':' + idempotencyKey}, 0))`;
        const existing = await tx.order.findFirst({
          where: { userId, idempotencyKey },
          include: { items: true, address: true },
        });
        if (existing) return existing;
      }
      const promoDiscount = promo?.discount ?? 0;
      const spend = dto.redeemPoints
        ? await this.loyalty.redeemPoints(tx, userId, dto.redeemPoints, subtotal - promoDiscount)
        : null;

      const discount = promoDiscount + (spend?.discount ?? 0);
      const total = Math.max(0, subtotal - discount) + deliveryFee;

      const created = await tx.order.create({
        data: {
          userId,
          idempotencyKey,
          branchId: branch.id,
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
          paymentMethod: total === 0 ? PaymentMethod.CASH_ON_DELIVERY : dto.paymentMethod,
          items: {
            create: priced.items.map((item) => ({
              productId: item.productId,
              productName: item.productName,
              sizeLabel: item.sizeLabel,
              variantName: item.variantName,
              doughTypeId: item.doughTypeId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              totalPrice: item.totalPrice,
              // The configuration stored on the order is the one the customer
              // built, found by the index the pricing carries. It used to be
              // `lines[idx]` — priced items aligned with cart lines only
              // because the check above refuses the whole order when anything
              // is unavailable, and `priceItems` *removes* unavailable lines.
              // Loosen that check and every line after the first gap would
              // silently be stored with its neighbour's toppings.
              config: lineByIndex(item.index).config as unknown as Prisma.InputJsonValue,
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

      await recordOrderEvent(tx, RMQ_EVENTS.ORDER_CREATED, {
        orderId: created.id,
        userId,
        total: created.total,
      });
      return created;
    });

    try {
      await this.cart.clear(userId);
    } catch {
      this.logger.warn(`Cart cleanup failed for order ${order.id}`);
    }

    return this.getOrder(userId, order.id, Role.USER);
  }

  /**
   * A scheduled delivery has to be far enough ahead for the kitchen to cook
   * it *and* fall inside opening hours — the form used to accept 04:00, which
   * nobody would have delivered.
   */
  private assertDeliverableAt(scheduledAt: string | undefined, branch: OrderableBranch): void {
    const when = new Date(scheduledAt ?? '');

    if (Number.isNaN(when.getTime())) {
      throw new BadRequestException('Некорректное время доставки');
    }

    if (when.getTime() < Date.now() + MIN_SCHEDULE_LEAD_MINUTES * 60 * 1000) {
      throw new BadRequestException(
        `Время доставки должно быть минимум через ${MIN_SCHEDULE_LEAD_MINUTES} минут`,
      );
    }

    this.assertWithinHours(when, branch);
  }

  /**
   * The kitchen has to be open right now, because an ASAP order is one it
   * starts on immediately.
   */
  private assertOpenNow(branch: OrderableBranch): void {
    this.assertWithinHours(new Date(), branch);
  }

  /**
   * Evaluated in the pizzeria's timezone, not the container's: the servers run
   * on UTC, so this check used to mean 13:00–02:00 in Makhachkala.
   */
  private assertWithinHours(when: Date, branch: OrderableBranch): void {
    const hours = { openMinute: branch.openMinute, closeMinute: branch.closeMinute };

    if (!isWithinOpeningHours(when, hours)) {
      throw new BadRequestException(
        `«${branch.name}» работает с ${formatOpeningMinute(hours.openMinute)} до ${formatOpeningMinute(hours.closeMinute)}`,
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
   * not need it at all. Least privilege has to be spelled out per role or it
   * collapses back into "staff".
   *
   * Support is the case where the honest answer is "all of them", and the
   * comment here used to promise otherwise — it said support's access was "a
   * different shape again" while the code read `return true`, identical to an
   * administrator's. A claim about access that the code does not implement is
   * worse than no claim: the next person reads the comment, believes the
   * narrowing exists, and builds on it.
   *
   * It really is all of them, because of when support is called: a customer
   * rings *after* their order went wrong, which rules out any scoping by
   * status, and they ring about an order support has no prior connection to,
   * which rules out scoping by assignment. Narrowing this properly means
   * linking a ticket to the order it is about and admitting access through
   * that link — a change to the support domain's data model, not a condition
   * that can be written here. Until then the honest position is: support reads
   * every order, that is a deliberate grant, and the audit log is what makes it
   * accountable rather than this function.
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
        // Deliberate, for the reasons above — not an oversight.
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

      await this.releaseConsumables(tx, userId, orderId, order.promocodeId);

      await recordOrderEvent(tx, RMQ_EVENTS.ORDER_STATUS_CHANGED, {
        orderId,
        userId,
        status: OrderStatus.CANCELLED,
        updatedAt: new Date(),
      });
      return tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { items: true, statusHistory: { orderBy: { changedAt: 'asc' } } },
      });
    });

    // Outside the transaction, because it is a call to somebody else's server
    // and a database transaction must not be held open across one.
    await this.refundMoney(orderId);

    // The customer is the actor here, and a cancelled order they later
    // dispute is otherwise a status with no author.
    await this.audit.record({
      action: AdminAction.ORDER_STATUS_CHANGED,
      actorId: userId,
      targetType: 'order',
      targetId: orderId,
      details: { from: order.status, to: OrderStatus.CANCELLED, by: 'customer' },
    });

    return cancelled;
  }

  /**
   * Cancels online orders nobody ever paid for.
   *
   * Checkout creates the order and *then* sends the customer to the bank, so
   * an order that is never paid is a real row: it holds the loyalty points it
   * spent, it holds one use of the promocode it applied, and it sits in
   * `CREATED` forever. The kitchen board already hides it — `adminListOrders`
   * filters unpaid online orders out, which is right — so it was invisible as
   * well as immortal. Nobody would ever have cleaned it up by hand, because
   * nobody could see it.
   *
   * The window is generous: a customer may well open the bank page, go and
   * find their card, and get distracted. What it has to be is finite.
   *
   * Each order is cancelled on its own, guarded on still being `CREATED`, so a
   * payment that lands while this runs wins and the order survives.
   */
  async expireUnpaidOnlineOrders(): Promise<{ cancelled: number }> {
    const cutoff = new Date(Date.now() - UNPAID_ORDER_TTL_MINUTES * 60 * 1000);

    const stale = await this.prisma.order.findMany({
      where: {
        status: OrderStatus.CREATED,
        paymentMethod: PaymentMethod.ONLINE,
        createdAt: { lt: cutoff },
        // Matches both "no payment was ever opened" and "one was opened and
        // never completed" — the same shape the staff board uses to decide an
        // order is not the kitchen's problem yet.
        NOT: { payment: { is: { status: PaymentStatus.SUCCEEDED } } },
      },
      select: { id: true, userId: true, promocodeId: true },
    });

    let cancelled = 0;

    for (const order of stale) {
      let didCancel = false;

      try {
        await this.prisma.$transaction(async (tx) => {
          const { count } = await tx.order.updateMany({
            where: {
              id: order.id,
              status: OrderStatus.CREATED,
              NOT: { payment: { is: { status: PaymentStatus.SUCCEEDED } } },
            },
            data: { status: OrderStatus.CANCELLED },
          });
          // The payment landed between the query above and this update: the
          // order is alive and none of our business.
          if (count === 0) return;

          await tx.orderStatusHistory.create({
            data: {
              orderId: order.id,
              status: OrderStatus.CANCELLED,
              // Nobody pressed anything; this is the clock.
              changedById: null,
            },
          });

          await this.releaseConsumables(tx, order.userId, order.id, order.promocodeId);
          await recordOrderEvent(tx, RMQ_EVENTS.ORDER_STATUS_CHANGED, {
            orderId: order.id,
            userId: order.userId,
            status: OrderStatus.CANCELLED,
            updatedAt: new Date(),
          });
          didCancel = true;
        });
      } catch (error) {
        // One stuck order must not stop the sweep from clearing the rest.
        this.logger.error(
          `Could not expire unpaid order ${order.id}`,
          error instanceof Error ? error.stack : String(error),
        );
        continue;
      }

      // Announced only if it actually happened. Telling a customer their order
      // was cancelled when the sweep lost to their payment would be the worst
      // possible moment to be wrong.
      if (!didCancel) continue;
      cancelled += 1;
    }

    if (cancelled > 0) {
      this.logger.log(
        `Cancelled ${cancelled} online orders unpaid for over ${UNPAID_ORDER_TTL_MINUTES} minutes`,
      );
    }

    return { cancelled };
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
              OR: [{ payment: { is: null } }, { payment: { is: { status: { not: 'SUCCEEDED' } } } }],
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

  async updateStatus(params: { orderId: string; status: OrderStatus; actorId: string; actorRole: Role }) {
    const { orderId, status: nextStatus, actorId: changedById, actorRole } = params;

    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Заказ не найден');

    if (order.paymentMethod === PaymentMethod.ONLINE && nextStatus !== OrderStatus.CANCELLED) {
      const payment = await this.prisma.payment.findUnique({ where: { orderId } });
      if (payment?.status !== PaymentStatus.SUCCEEDED)
        throw new BadRequestException('Сначала дождитесь оплаты заказа');
    }

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

      // A staff cancellation gave nothing back. `cancelByCustomer` returned the
      // points and released the promocode; this path — the one support uses
      // when a customer phones, and the only one that can cancel an order
      // already in the oven — did neither. The same order cost the customer
      // their points or not depending on who pressed the button.
      if (nextStatus === OrderStatus.CANCELLED) {
        await this.releaseConsumables(tx, order.userId, orderId, order.promocodeId);
      }

      await recordOrderEvent(tx, RMQ_EVENTS.ORDER_STATUS_CHANGED, {
        orderId,
        userId: order.userId,
        status: nextStatus,
        updatedAt: result.updatedAt,
        total: result.total,
      });
      return result;
    });

    if (nextStatus === OrderStatus.CANCELLED) await this.refundMoney(orderId);

    // Who moved the order, and from what. A cancelled order a customer
    // disputes is otherwise a status with no author.
    await this.audit.record({
      action: AdminAction.ORDER_STATUS_CHANGED,
      actorId: changedById,
      targetType: 'order',
      targetId: orderId,
      details: { from: order.status, to: nextStatus },
    });

    return updated;
  }
}
