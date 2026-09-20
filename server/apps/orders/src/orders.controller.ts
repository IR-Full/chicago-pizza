import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { ORDERS_PATTERNS, PizzaConfigDto } from '@chicago-pizza/common';
import { DiscountType, OrderStatus, Role } from '@chicago-pizza/prisma';
import { CartService } from './services/cart.service';
import { OrderService } from './services/order.service';
import { PromocodeService } from './services/promocode.service';
import { LoyaltyService } from './services/loyalty.service';
import { CheckoutDto } from './dto/checkout.dto';

@Controller()
export class OrdersController {
  constructor(
    private readonly cart: CartService,
    private readonly orders: OrderService,
    private readonly promocodes: PromocodeService,
    private readonly loyalty: LoyaltyService,
  ) {}

  // ── Cart ─────────────────────────────────────────────────────

  @MessagePattern(ORDERS_PATTERNS.GET_CART)
  getCart(@Payload() payload: { userId: string }) {
    return this.cart.getCart(payload.userId);
  }

  @MessagePattern(ORDERS_PATTERNS.ADD_CART_ITEM)
  addCartItem(@Payload() payload: { userId: string; config: PizzaConfigDto; quantity: number }) {
    return this.cart.addItem(payload.userId, payload.config, payload.quantity);
  }

  @MessagePattern(ORDERS_PATTERNS.UPDATE_CART_ITEM)
  updateCartItem(@Payload() payload: { userId: string; lineId: string; quantity: number }) {
    return this.cart.updateItem(payload.userId, payload.lineId, payload.quantity);
  }

  @MessagePattern(ORDERS_PATTERNS.REMOVE_CART_ITEM)
  removeCartItem(@Payload() payload: { userId: string; lineId: string }) {
    return this.cart.removeItem(payload.userId, payload.lineId);
  }

  @MessagePattern(ORDERS_PATTERNS.CLEAR_CART)
  clearCart(@Payload() payload: { userId: string }) {
    return this.cart.clear(payload.userId);
  }

  @MessagePattern(ORDERS_PATTERNS.APPLY_PROMOCODE)
  applyPromocode(@Payload() payload: { code: string; subtotal: number; userId?: string }) {
    // The user id makes the per-customer limit visible already in the cart,
    // instead of failing only at checkout.
    return this.promocodes.validate(payload.code, payload.subtotal, payload.userId);
  }

  // ── Orders ───────────────────────────────────────────────────

  @MessagePattern(ORDERS_PATTERNS.CHECKOUT)
  checkout(@Payload() payload: { userId: string; dto: CheckoutDto }) {
    return this.orders.checkout(payload.userId, payload.dto);
  }

  @MessagePattern(ORDERS_PATTERNS.LIST_ORDERS)
  listOrders(@Payload() payload: { userId: string; page?: number; limit?: number }) {
    return this.orders.listOrders(payload.userId, payload.page, payload.limit);
  }

  @MessagePattern(ORDERS_PATTERNS.GET_ORDER)
  getOrder(@Payload() payload: { userId: string; orderId: string; role: Role }) {
    return this.orders.getOrder(payload.userId, payload.orderId, payload.role);
  }

  @MessagePattern(ORDERS_PATTERNS.REPEAT_ORDER)
  repeatOrder(@Payload() payload: { userId: string; orderId: string }) {
    return this.orders.repeatOrder(payload.userId, payload.orderId);
  }

  @MessagePattern(ORDERS_PATTERNS.SUBMIT_REVIEW)
  submitReview(@Payload() payload: { userId: string; orderId: string; rating: number; comment?: string }) {
    return this.orders.submitReview(payload.userId, payload.orderId, payload.rating, payload.comment);
  }

  /** Public: the home page quotes real reviews of delivered orders. */
  @MessagePattern(ORDERS_PATTERNS.LIST_RECENT_REVIEWS)
  listRecentReviews(@Payload() payload: { limit?: number }) {
    return this.orders.listRecentReviews(payload?.limit);
  }

  // ── Loyalty & referrals ──────────────────────────────────────

  @MessagePattern(ORDERS_PATTERNS.GET_LOYALTY)
  getLoyalty(@Payload() payload: { userId: string }) {
    return this.loyalty.getSummary(payload.userId);
  }

  @MessagePattern(ORDERS_PATTERNS.GET_REFERRAL_INFO)
  getReferralInfo(@Payload() payload: { userId: string }) {
    return this.loyalty.getReferralInfo(payload.userId);
  }

  // ── Staff ────────────────────────────────────────────────────

  // ── Personal data ────────────────────────────────────────────

  @MessagePattern(ORDERS_PATTERNS.EXPORT_DATA)
  exportData(@Payload() payload: { userId: string }) {
    return this.orders.exportForUser(payload.userId);
  }

  @MessagePattern(ORDERS_PATTERNS.ANONYMIZE_USER)
  anonymizeUser(@Payload() payload: { userId: string }) {
    return this.orders.anonymizeUser(payload.userId);
  }

  @MessagePattern(ORDERS_PATTERNS.ADMIN_LIST_ORDERS)
  adminListOrders(
    @Payload()
    payload: { page: number; limit: number; status?: OrderStatus; actorId: string; actorRole: Role },
  ) {
    return this.orders.adminListOrders(payload);
  }

  @MessagePattern(ORDERS_PATTERNS.ADMIN_UPDATE_STATUS)
  adminUpdateStatus(@Payload() payload: { orderId: string; status: OrderStatus; changedById: string }) {
    return this.orders.updateStatus(payload.orderId, payload.status, payload.changedById);
  }

  @MessagePattern(ORDERS_PATTERNS.ADMIN_LIST_PROMOCODES)
  adminListPromocodes() {
    return this.promocodes.list();
  }

  @MessagePattern(ORDERS_PATTERNS.ADMIN_CREATE_PROMOCODE)
  adminCreatePromocode(
    @Payload()
    payload: {
      code: string;
      discountType: DiscountType;
      discountValue: number;
      minOrderAmount?: number;
      maxUses?: number;
      expiresAt?: string;
      actorId?: string;
    },
  ) {
    const { actorId, ...data } = payload;
    return this.promocodes.create(
      { ...data, expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined },
      actorId,
    );
  }
}
