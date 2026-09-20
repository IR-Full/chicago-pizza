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
import { OrderStatus, Role } from '@chicago-pizza/prisma';
import { CreatePromocodeDto, UpdateOrderStatusDto } from '../dto/orders.dto';
import {
  AdminOrderQueryDto,
  AdminTicketQueryDto,
  AdminUserQueryDto,
  CreateCategoryDto,
  CreateProductDto,
  SetUserBlockedDto,
  SetUserRoleDto,
  UpdateProductDto,
} from '../dto/admin.dto';
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
  listOrders(@CurrentUser() actor: JwtPayload, @Query() query: AdminOrderQueryDto) {
    return rpcSend(this.orders, ORDERS_PATTERNS.ADMIN_LIST_ORDERS, {
      page: query.page,
      limit: query.limit,
      status: query.status,
      // The board is scoped by who is asking: a courier gets their own
      // deliveries, not every customer's address and phone number.
      actorId: actor.sub,
      actorRole: actor.role,
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
    // The notifications service persists a row for exactly this event; the
    // ping is what makes the customer's bell notice it without a reload.
    this.realtime.emitNotification(order.userId);

    return order;
  }

  // ── Catalog ──────────────────────────────────────────────────

  @Roles(Role.ADMIN)
  @Post('categories')
  createCategory(@CurrentUser() actor: JwtPayload, @Body() dto: CreateCategoryDto) {
    // The actor travels with every catalog mutation so the audit trail has an
    // author; a price change with no name attached explains nothing later.
    return rpcSend(this.products, PRODUCTS_PATTERNS.ADMIN_CREATE_CATEGORY, { ...dto, actorId: actor.sub });
  }

  @Roles(Role.ADMIN)
  @Post('products')
  @ApiOperation({ summary: 'Создать товар (для пицц передайте массив sizes)' })
  createProduct(@CurrentUser() actor: JwtPayload, @Body() dto: CreateProductDto) {
    return rpcSend(this.products, PRODUCTS_PATTERNS.ADMIN_CREATE_PRODUCT, { ...dto, actorId: actor.sub });
  }

  @Roles(Role.ADMIN)
  @Patch('products/:id')
  updateProduct(
    @CurrentUser() actor: JwtPayload,
    @Param('id', ParseUUIDPipe) productId: string,
    @Body() data: UpdateProductDto,
  ) {
    return rpcSend(this.products, PRODUCTS_PATTERNS.ADMIN_UPDATE_PRODUCT, {
      productId,
      data,
      actorId: actor.sub,
    });
  }

  @Roles(Role.ADMIN)
  @Delete('products/:id')
  @ApiOperation({ summary: 'Снять товар с продажи (мягкое удаление)' })
  deleteProduct(@CurrentUser() actor: JwtPayload, @Param('id', ParseUUIDPipe) productId: string) {
    return rpcSend(this.products, PRODUCTS_PATTERNS.ADMIN_DELETE_PRODUCT, { productId, actorId: actor.sub });
  }

  // ── Promocodes ───────────────────────────────────────────────

  @Roles(Role.ADMIN)
  @Get('promocodes')
  listPromocodes() {
    return rpcSend(this.orders, ORDERS_PATTERNS.ADMIN_LIST_PROMOCODES, {});
  }

  @Roles(Role.ADMIN)
  @Post('promocodes')
  createPromocode(@CurrentUser() actor: JwtPayload, @Body() dto: CreatePromocodeDto) {
    return rpcSend(this.orders, ORDERS_PATTERNS.ADMIN_CREATE_PROMOCODE, { ...dto, actorId: actor.sub });
  }

  // ── Users ────────────────────────────────────────────────────

  @Roles(Role.ADMIN)
  @Get('users')
  listUsers(@Query() query: AdminUserQueryDto) {
    return rpcSend(this.auth, AUTH_PATTERNS.ADMIN_LIST_USERS, {
      page: query.page,
      limit: query.limit,
      search: query.search,
    });
  }

  @Roles(Role.ADMIN)
  @Patch('users/:id/role')
  setUserRole(
    @CurrentUser() actor: JwtPayload,
    @Param('id', ParseUUIDPipe) userId: string,
    @Body() dto: SetUserRoleDto,
  ) {
    // The actor travels with the request so the auth service can refuse
    // self-demotion and the removal of the last administrator.
    return rpcSend(this.auth, AUTH_PATTERNS.ADMIN_SET_ROLE, {
      userId,
      role: dto.role,
      actorId: actor.sub,
    });
  }

  @Roles(Role.ADMIN)
  @Patch('users/:id/blocked')
  setUserBlocked(
    @CurrentUser() actor: JwtPayload,
    @Param('id', ParseUUIDPipe) userId: string,
    @Body() dto: SetUserBlockedDto,
  ) {
    return rpcSend(this.auth, AUTH_PATTERNS.ADMIN_SET_BLOCKED, {
      userId,
      isBlocked: dto.isBlocked,
      actorId: actor.sub,
    });
  }

  // ── Support ──────────────────────────────────────────────────

  @Roles(Role.ADMIN, Role.SUPPORT)
  @Get('tickets')
  listTickets(@Query() query: AdminTicketQueryDto) {
    return rpcSend(this.support, SUPPORT_PATTERNS.ADMIN_LIST_TICKETS, {
      page: query.page,
      limit: query.limit,
      status: query.status,
    });
  }
}
