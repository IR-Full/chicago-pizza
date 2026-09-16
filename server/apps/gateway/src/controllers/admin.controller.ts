import { Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientProxy } from '@nestjs/microservices';
import {
  AUTH_PATTERNS,
  CurrentUser,
  JwtPayload,
  ORDERS_PATTERNS,
  PRODUCTS_PATTERNS,
  Roles,
  rpcSend,
  SUPPORT_PATTERNS,
} from '@chicago-pizza/common';
import { OrderStatus, Prisma, Role, TicketStatus } from '@chicago-pizza/prisma';
import { CreatePromocodeDto, UpdateOrderStatusDto } from '../dto/orders.dto';
import { RealtimeGateway } from '../realtime/realtime.gateway';

@ApiTags('admin')
@ApiCookieAuth()
@Controller('admin')
export class AdminController {
  constructor(
    @Inject('AUTH_SERVICE') private readonly auth: ClientProxy,
    @Inject('PRODUCTS_SERVICE') private readonly products: ClientProxy,
    @Inject('ORDERS_SERVICE') private readonly orders: ClientProxy,
    @Inject('SUPPORT_SERVICE') private readonly support: ClientProxy,
    private readonly realtime: RealtimeGateway,
  ) {}

  // ── Orders (admin + courier) ─────────────────────────────────

  @Roles(Role.ADMIN, Role.COURIER)
  @Get('orders')
  @ApiOperation({ summary: 'Все заказы для кухни и курьеров' })
  listOrders(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('status') status?: OrderStatus,
  ) {
    return rpcSend(this.orders, ORDERS_PATTERNS.ADMIN_LIST_ORDERS, {
      page: Number(page),
      limit: Number(limit),
      status,
    });
  }

  @Roles(Role.ADMIN, Role.COURIER)
  @Patch('orders/:id/status')
  @ApiOperation({ summary: 'Сменить статус заказа — клиент получит push по WebSocket' })
  async updateOrderStatus(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) orderId: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    const order = await rpcSend<{ id: string; userId: string; status: OrderStatus; updatedAt: string }>(
      this.orders,
      ORDERS_PATTERNS.ADMIN_UPDATE_STATUS,
      { orderId, status: dto.status, changedById: user.sub },
    );

    this.realtime.emitOrderStatus(order.userId, {
      orderId: order.id,
      status: order.status,
      updatedAt: order.updatedAt,
    });

    return order;
  }

  // ── Catalog ──────────────────────────────────────────────────

  @Roles(Role.ADMIN)
  @Post('categories')
  createCategory(@Body() body: { name: string; slug: string; description?: string; sortOrder?: number }) {
    return rpcSend(this.products, PRODUCTS_PATTERNS.ADMIN_CREATE_CATEGORY, body);
  }

  @Roles(Role.ADMIN)
  @Post('products')
  @ApiOperation({ summary: 'Создать товар (для пицц передайте массив sizes)' })
  createProduct(
    @Body()
    body: Prisma.ProductUncheckedCreateInput & { sizes?: { sizeCm: number; label: string; price: number }[] },
  ) {
    return rpcSend(this.products, PRODUCTS_PATTERNS.ADMIN_CREATE_PRODUCT, body);
  }

  @Roles(Role.ADMIN)
  @Patch('products/:id')
  updateProduct(
    @Param('id', ParseUUIDPipe) productId: string,
    @Body() data: Prisma.ProductUncheckedUpdateInput,
  ) {
    return rpcSend(this.products, PRODUCTS_PATTERNS.ADMIN_UPDATE_PRODUCT, { productId, data });
  }

  @Roles(Role.ADMIN)
  @Delete('products/:id')
  @ApiOperation({ summary: 'Снять товар с продажи (мягкое удаление)' })
  deleteProduct(@Param('id', ParseUUIDPipe) productId: string) {
    return rpcSend(this.products, PRODUCTS_PATTERNS.ADMIN_DELETE_PRODUCT, { productId });
  }

  // ── Promocodes ───────────────────────────────────────────────

  @Roles(Role.ADMIN)
  @Get('promocodes')
  listPromocodes() {
    return rpcSend(this.orders, ORDERS_PATTERNS.ADMIN_LIST_PROMOCODES, {});
  }

  @Roles(Role.ADMIN)
  @Post('promocodes')
  createPromocode(@Body() dto: CreatePromocodeDto) {
    return rpcSend(this.orders, ORDERS_PATTERNS.ADMIN_CREATE_PROMOCODE, dto);
  }

  // ── Users ────────────────────────────────────────────────────

  @Roles(Role.ADMIN)
  @Get('users')
  listUsers(@Query('page') page = '1', @Query('limit') limit = '20', @Query('search') search?: string) {
    return rpcSend(this.auth, AUTH_PATTERNS.ADMIN_LIST_USERS, {
      page: Number(page),
      limit: Number(limit),
      search,
    });
  }

  @Roles(Role.ADMIN)
  @Patch('users/:id/role')
  setUserRole(@Param('id', ParseUUIDPipe) userId: string, @Body() body: { role: Role }) {
    return rpcSend(this.auth, AUTH_PATTERNS.ADMIN_SET_ROLE, { userId, role: body.role });
  }

  @Roles(Role.ADMIN)
  @Patch('users/:id/blocked')
  setUserBlocked(@Param('id', ParseUUIDPipe) userId: string, @Body() body: { isBlocked: boolean }) {
    return rpcSend(this.auth, AUTH_PATTERNS.ADMIN_SET_BLOCKED, { userId, isBlocked: body.isBlocked });
  }

  // ── Support ──────────────────────────────────────────────────

  @Roles(Role.ADMIN, Role.SUPPORT)
  @Get('tickets')
  listTickets(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('status') status?: TicketStatus,
  ) {
    return rpcSend(this.support, SUPPORT_PATTERNS.ADMIN_LIST_TICKETS, {
      page: Number(page),
      limit: Number(limit),
      status,
    });
  }
}
