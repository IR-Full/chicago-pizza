import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
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
  AdminProductQueryDto,
  AdminTicketQueryDto,
  AdminUserQueryDto,
  AnalyticsQueryDto,
  CreateBranchDto,
  CreateCategoryDto,
  CreateZoneDto,
  CreateProductDto,
  SetUserBlockedDto,
  SetUserRoleDto,
  StopProductDto,
  UpdateBranchDto,
  UpdateProductDto,
  UpdateZoneDto,
} from '../dto/admin.dto';

/** The window a report covers when nobody says otherwise. */
const DEFAULT_REPORT_DAYS = 30;

/** A cap, so one request cannot ask for the shop's entire history. */
const MAX_REPORT_DAYS = 366;

@ApiTags('admin')
@ApiCookieAuth()
@Controller('admin')
export class AdminController {
  constructor(
    @Inject('AUTH_SERVICE') private readonly auth: ClientProxy,
    @Inject('PRODUCTS_SERVICE') private readonly products: ClientProxy,
    @Inject('ORDERS_SERVICE') private readonly orders: ClientProxy,
    @Inject('SUPPORT_SERVICE') private readonly support: ClientProxy,
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
      // The kitchen screen watches one branch and only what is still in play.
      branchId: query.branchId,
      liveOnly: query.liveOnly,
      // The board is scoped by who is asking: a courier gets their own
      // deliveries, not every customer's address and phone number.
      actorId: actor.sub,
      actorRole: actor.role,
    });
  }

  @Roles(Role.ADMIN, Role.COURIER)
  @Patch('orders/:id/status')
  @ApiOperation({ summary: 'Сменить статус заказа — клиент получит push по WebSocket' })
  updateOrderStatus(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) orderId: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    // The WebSocket push follows the `order.status.changed` event, not this
    // request — see `RealtimeEventsController`. Pushing from here meant a
    // status changed by anything other than this endpoint moved silently.
    return rpcSend<{ id: string; userId: string; status: OrderStatus; updatedAt: string }>(
      this.orders,
      ORDERS_PATTERNS.ADMIN_UPDATE_STATUS,
      // The role travels with the request: a courier may finish their own
      // delivery, not cancel any order in the shop.
      { orderId, status: dto.status, actorId: user.sub, actorRole: user.role },
    );
  }

  // ── Analytics ────────────────────────────────────────────────

  /**
   * The owner's report. Admin only: it is the whole shop's revenue.
   *
   * The window is resolved here rather than in the orders service so the
   * default — the last thirty days — is stated once, at the edge, where the
   * caller can see it in the API docs.
   */
  @Roles(Role.ADMIN)
  @Get('analytics')
  @ApiOperation({ summary: 'Выручка, средний чек, топ позиций, отмены, промокоды' })
  analytics(@Query() query: AnalyticsQueryDto) {
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from
      ? new Date(query.from)
      : new Date(to.getTime() - DEFAULT_REPORT_DAYS * 24 * 60 * 60 * 1000);

    if (from >= to) throw new BadRequestException('Начало периода должно быть раньше конца');

    const days = (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000);
    if (days > MAX_REPORT_DAYS) {
      throw new BadRequestException(`Период не может быть длиннее ${MAX_REPORT_DAYS} дней`);
    }

    return rpcSend(this.orders, ORDERS_PATTERNS.ADMIN_ANALYTICS, {
      from: from.toISOString(),
      to: to.toISOString(),
      branchId: query.branchId,
    });
  }

  // ── Branches ─────────────────────────────────────────────────

  @Roles(Role.ADMIN)
  @Get('branches')
  @ApiOperation({ summary: 'Все точки, включая закрытые' })
  listBranches() {
    return rpcSend(this.products, PRODUCTS_PATTERNS.ADMIN_LIST_BRANCHES, {});
  }

  @Roles(Role.ADMIN)
  @Post('branches')
  createBranch(@CurrentUser() actor: JwtPayload, @Body() dto: CreateBranchDto) {
    return rpcSend(this.products, PRODUCTS_PATTERNS.ADMIN_CREATE_BRANCH, { ...dto, actorId: actor.sub });
  }

  @Roles(Role.ADMIN)
  @Patch('branches/:id')
  @ApiOperation({ summary: 'Изменить точку. isActive=false закрывает её для новых заказов' })
  updateBranch(
    @CurrentUser() actor: JwtPayload,
    @Param('id', ParseUUIDPipe) branchId: string,
    @Body() data: UpdateBranchDto,
  ) {
    // Never deleted: orders point at a branch, and a closed one still has to
    // account for the deliveries it made.
    return rpcSend(this.products, PRODUCTS_PATTERNS.ADMIN_UPDATE_BRANCH, {
      branchId,
      data,
      actorId: actor.sub,
    });
  }

  // ── Delivery zones ───────────────────────────────────────────

  @Roles(Role.ADMIN)
  @Get('zones')
  @ApiOperation({ summary: 'Зоны доставки со стоимостью и минимальной суммой' })
  listZones() {
    return rpcSend(this.products, PRODUCTS_PATTERNS.ADMIN_LIST_ZONES, {});
  }

  @Roles(Role.ADMIN)
  @Post('zones')
  @ApiOperation({ summary: 'Создать зону. Пересекающиеся зоны разрешает sortOrder' })
  createZone(@CurrentUser() actor: JwtPayload, @Body() dto: CreateZoneDto) {
    return rpcSend(this.products, PRODUCTS_PATTERNS.ADMIN_CREATE_ZONE, { ...dto, actorId: actor.sub });
  }

  @Roles(Role.ADMIN)
  @Patch('zones/:id')
  updateZone(
    @CurrentUser() actor: JwtPayload,
    @Param('id', ParseUUIDPipe) zoneId: string,
    @Body() data: UpdateZoneDto,
  ) {
    return rpcSend(this.products, PRODUCTS_PATTERNS.ADMIN_UPDATE_ZONE, {
      zoneId,
      data,
      actorId: actor.sub,
    });
  }

  // ── Catalog ──────────────────────────────────────────────────

  @Roles(Role.ADMIN)
  @Post('categories')
  createCategory(@CurrentUser() actor: JwtPayload, @Body() dto: CreateCategoryDto) {
    // The actor travels with every catalog mutation so the audit trail has an
    // author; a price change with no name attached explains nothing later.
    return rpcSend(this.products, PRODUCTS_PATTERNS.ADMIN_CREATE_CATEGORY, { ...dto, actorId: actor.sub });
  }

  /**
   * The menu for the editor — delisted items included, so something taken off
   * can be put back. Admin only: the stop list below is the part the kitchen
   * needs, and it is narrower.
   */
  @Roles(Role.ADMIN)
  @Get('products')
  @ApiOperation({ summary: 'Все товары, включая снятые с продажи' })
  listProducts(@Query() query: AdminProductQueryDto) {
    return rpcSend(this.products, PRODUCTS_PATTERNS.ADMIN_LIST_PRODUCTS, {
      page: query.page,
      limit: query.limit,
      search: query.search,
      categoryId: query.categoryId,
    });
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

  /**
   * The stop list.
   *
   * Granted to `COURIER` alongside `ADMIN`, and the reasoning used to be about
   * the kitchen — "the person who notices the mozzarella has run out is the one
   * standing at the oven". True, and an argument for a role this project does
   * not have: there is no `KITCHEN`, so `COURIER` is what every non-managerial
   * member of staff is given, whether they drive or cook.
   *
   * Stated plainly rather than dressed up, because the two readings imply
   * different permissions. Taking items off the menu is a kitchen job; a
   * courier can currently do it because the roles are coarser than the shop is.
   * Splitting them is a product decision — it means deciding what existing
   * courier accounts are, and re-assigning them — not something to slip in
   * under a comment about mozzarella.
   */
  @Roles(Role.ADMIN, Role.COURIER)
  @Get('stop-list')
  @ApiOperation({ summary: 'Что сейчас снято с продажи' })
  listStopped() {
    return rpcSend(this.products, PRODUCTS_PATTERNS.ADMIN_LIST_STOPPED, {});
  }

  @Roles(Role.ADMIN, Role.COURIER)
  @Patch('products/:id/stop')
  @ApiOperation({ summary: 'Снять позицию на время (0 минут — вернуть в продажу)' })
  stopProduct(
    @CurrentUser() actor: JwtPayload,
    @Param('id', ParseUUIDPipe) productId: string,
    @Body() dto: StopProductDto,
  ) {
    return rpcSend(this.products, PRODUCTS_PATTERNS.ADMIN_SET_PRODUCT_STOPPED, {
      productId,
      // The client sends a duration; the moment it expires is computed here,
      // on the server clock, so a staff device with a wrong time cannot put
      // an item back early — or leave it off for a day.
      stoppedUntil: dto.minutes > 0 ? new Date(Date.now() + dto.minutes * 60_000).toISOString() : null,
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
