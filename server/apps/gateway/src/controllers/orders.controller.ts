import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientProxy } from '@nestjs/microservices';
import {
  CurrentUser,
  JwtPayload,
  ORDERS_PATTERNS,
  PaginationDto,
  Public,
  rpcSend,
} from '@chicago-pizza/common';
import {
  AddCartItemDto,
  ApplyPromocodeDto,
  CheckoutBodyDto,
  GuestCartDto,
  PaymentNotificationDto,
  SubmitReviewDto,
  UpdateCartItemDto,
} from '../dto/orders.dto';

/**
 * What an `Idempotency-Key` may look like. The value becomes part of a Redis
 * key, so it is bounded rather than taken as given; anything else is a client
 * bug worth reporting instead of silently dropping the protection it asked
 * for.
 */
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,128}$/;

@ApiTags('cart & orders')
@ApiCookieAuth()
@Controller()
export class OrdersController {
  constructor(@Inject('ORDERS_SERVICE') private readonly orders: ClientProxy) {}

  // ── Cart ─────────────────────────────────────────────────────

  @Get('cart')
  @ApiOperation({ summary: 'Текущая корзина с пересчитанными ценами' })
  getCart(@CurrentUser() user: JwtPayload) {
    return rpcSend(this.orders, ORDERS_PATTERNS.GET_CART, { userId: user.sub });
  }

  @Post('cart/items')
  @ApiOperation({ summary: 'Добавить собранный товар в корзину' })
  addItem(@CurrentUser() user: JwtPayload, @Body() dto: AddCartItemDto) {
    return rpcSend(this.orders, ORDERS_PATTERNS.ADD_CART_ITEM, {
      userId: user.sub,
      config: dto.config,
      quantity: dto.quantity,
    });
  }

  @Patch('cart/items/:lineId')
  updateItem(
    @CurrentUser() user: JwtPayload,
    @Param('lineId') lineId: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    return rpcSend(this.orders, ORDERS_PATTERNS.UPDATE_CART_ITEM, {
      userId: user.sub,
      lineId,
      quantity: dto.quantity,
    });
  }

  @Delete('cart/items/:lineId')
  removeItem(@CurrentUser() user: JwtPayload, @Param('lineId') lineId: string) {
    return rpcSend(this.orders, ORDERS_PATTERNS.REMOVE_CART_ITEM, { userId: user.sub, lineId });
  }

  @Delete('cart')
  clearCart(@CurrentUser() user: JwtPayload) {
    return rpcSend(this.orders, ORDERS_PATTERNS.CLEAR_CART, { userId: user.sub });
  }

  /**
   * Prices a cart that has no account behind it yet.
   *
   * Public on purpose: a visitor must be able to fill a basket and see what it
   * costs before being asked to register. Nothing is stored — the browser owns
   * the list, this only values it.
   */
  @Public()
  @Post('cart/preview')
  @ApiOperation({ summary: 'Посчитать гостевую корзину (ничего не сохраняется)' })
  previewCart(@Body() dto: GuestCartDto) {
    return rpcSend(this.orders, ORDERS_PATTERNS.PREVIEW_CART, { lines: dto.lines });
  }

  @Post('cart/merge')
  @ApiOperation({ summary: 'Перенести гостевую корзину в корзину аккаунта после входа' })
  mergeCart(@CurrentUser() user: JwtPayload, @Body() dto: GuestCartDto) {
    return rpcSend(this.orders, ORDERS_PATTERNS.MERGE_CART, { userId: user.sub, lines: dto.lines });
  }

  @Post('cart/promocode')
  @ApiOperation({ summary: 'Проверить промокод для текущей корзины' })
  async applyPromocode(@CurrentUser() user: JwtPayload, @Body() dto: ApplyPromocodeDto) {
    const cart = await rpcSend<{ subtotal: number }>(this.orders, ORDERS_PATTERNS.GET_CART, {
      userId: user.sub,
    });
    return rpcSend(this.orders, ORDERS_PATTERNS.APPLY_PROMOCODE, {
      code: dto.code,
      subtotal: cart.subtotal,
      userId: user.sub,
    });
  }

  // ── Orders ───────────────────────────────────────────────────

  @Post('orders')
  @ApiOperation({ summary: 'Оформить заказ (цены пересчитываются на сервере)' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Уникальный ключ попытки оформления. Повторный запрос с тем же ключом вернёт уже созданный заказ, а не создаст второй.',
  })
  checkout(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CheckoutBodyDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    if (idempotencyKey !== undefined && !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      throw new BadRequestException('Некорректный Idempotency-Key');
    }

    return rpcSend(this.orders, ORDERS_PATTERNS.CHECKOUT, { userId: user.sub, dto, idempotencyKey });
  }

  @Get('orders')
  @ApiOperation({ summary: 'История заказов' })
  listOrders(@CurrentUser() user: JwtPayload, @Query() query: PaginationDto) {
    return rpcSend(this.orders, ORDERS_PATTERNS.LIST_ORDERS, {
      userId: user.sub,
      page: query.page,
      limit: query.limit,
    });
  }

  @Get('orders/:id')
  getOrder(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) orderId: string) {
    return rpcSend(this.orders, ORDERS_PATTERNS.GET_ORDER, { userId: user.sub, orderId, role: user.role });
  }

  @Post('orders/:id/repeat')
  @ApiOperation({ summary: 'Повторить заказ — товары возвращаются в корзину' })
  repeatOrder(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) orderId: string) {
    return rpcSend(this.orders, ORDERS_PATTERNS.REPEAT_ORDER, { userId: user.sub, orderId });
  }

  @Post('orders/:id/cancel')
  @ApiOperation({ summary: 'Отменить заказ, пока его не приняли на кухню' })
  cancelOrder(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) orderId: string) {
    return rpcSend(this.orders, ORDERS_PATTERNS.CANCEL_ORDER, { userId: user.sub, orderId });
  }

  // ── Payment ──────────────────────────────────────────────────

  /**
   * Whether the shop can take money online at all.
   *
   * Public: the checkout has to know before it offers the option, and a
   * visitor asking is not disclosing anything.
   */
  @Public()
  @Get('payments/enabled')
  @ApiOperation({ summary: 'Доступна ли онлайн-оплата (настроен ли провайдер)' })
  paymentEnabled() {
    return rpcSend(this.orders, ORDERS_PATTERNS.PAYMENT_ENABLED, {});
  }

  @Post('orders/:id/pay')
  @ApiOperation({ summary: 'Открыть оплату заказа — возвращает ссылку на платёжную страницу' })
  startPayment(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) orderId: string) {
    return rpcSend(this.orders, ORDERS_PATTERNS.START_PAYMENT, { userId: user.sub, orderId });
  }

  @Get('orders/:id/payment')
  paymentStatus(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) orderId: string) {
    return rpcSend(this.orders, ORDERS_PATTERNS.PAYMENT_STATUS, { userId: user.sub, orderId });
  }

  /**
   * The provider's notification.
   *
   * Public because the provider is not a signed-in user, and deliberately
   * credulous about nothing: the only thing taken from the body is which
   * payment to go and look at. The state is re-read over an authenticated
   * call, so a forged POST achieves precisely nothing.
   *
   * Always answers 200. A provider that receives anything else retries for
   * hours, and the one case where that matters — a payment we do not know —
   * is not something a retry will fix.
   */
  @Public()
  @Post('payments/webhook')
  @HttpCode(200)
  @ApiOperation({ summary: 'Уведомление платёжного провайдера (тело не является источником истины)' })
  async paymentWebhook(@Body() body: PaymentNotificationDto) {
    const providerPaymentId = body.object?.id;
    if (!providerPaymentId) return { received: true };

    await rpcSend(this.orders, ORDERS_PATTERNS.PAYMENT_NOTIFICATION, { providerPaymentId }).catch(
      () => undefined,
    );

    return { received: true };
  }

  @Post('orders/:id/review')
  @ApiOperation({ summary: 'Оценить доставленный заказ' })
  submitReview(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) orderId: string,
    @Body() dto: SubmitReviewDto,
  ) {
    return rpcSend(this.orders, ORDERS_PATTERNS.SUBMIT_REVIEW, {
      userId: user.sub,
      orderId,
      rating: dto.rating,
      comment: dto.comment,
    });
  }

  // ── Loyalty & referrals ──────────────────────────────────────

  @Get('loyalty')
  @ApiOperation({ summary: 'Баллы, уровень и история начислений' })
  getLoyalty(@CurrentUser() user: JwtPayload) {
    return rpcSend(this.orders, ORDERS_PATTERNS.GET_LOYALTY, { userId: user.sub });
  }

  @Get('referrals')
  @ApiOperation({ summary: 'Реферальный код и статистика приглашений' })
  getReferrals(@CurrentUser() user: JwtPayload) {
    return rpcSend(this.orders, ORDERS_PATTERNS.GET_REFERRAL_INFO, { userId: user.sub });
  }
}
