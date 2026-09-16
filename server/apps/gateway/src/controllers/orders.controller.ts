import { Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientProxy } from '@nestjs/microservices';
import { CurrentUser, JwtPayload, ORDERS_PATTERNS, rpcSend } from '@chicago-pizza/common';
import { AddCartItemDto, ApplyPromocodeDto, CheckoutBodyDto, SubmitReviewDto, UpdateCartItemDto } from '../dto/orders.dto';

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

  @Post('cart/promocode')
  @ApiOperation({ summary: 'Проверить промокод для текущей корзины' })
  async applyPromocode(@CurrentUser() user: JwtPayload, @Body() dto: ApplyPromocodeDto) {
    const cart = await rpcSend<{ subtotal: number }>(this.orders, ORDERS_PATTERNS.GET_CART, { userId: user.sub });
    return rpcSend(this.orders, ORDERS_PATTERNS.APPLY_PROMOCODE, { code: dto.code, subtotal: cart.subtotal });
  }

  // ── Orders ───────────────────────────────────────────────────

  @Post('orders')
  @ApiOperation({ summary: 'Оформить заказ (цены пересчитываются на сервере)' })
  checkout(@CurrentUser() user: JwtPayload, @Body() dto: CheckoutBodyDto) {
    return rpcSend(this.orders, ORDERS_PATTERNS.CHECKOUT, { userId: user.sub, dto });
  }

  @Get('orders')
  @ApiOperation({ summary: 'История заказов' })
  listOrders(
    @CurrentUser() user: JwtPayload,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return rpcSend(this.orders, ORDERS_PATTERNS.LIST_ORDERS, {
      userId: user.sub,
      page: Number(page),
      limit: Number(limit),
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
