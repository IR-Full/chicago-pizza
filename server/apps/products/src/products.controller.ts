import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { ConfiguredItemDto, PizzaConfigDto, PRODUCTS_PATTERNS } from '@chicago-pizza/common';
import { Prisma } from '@chicago-pizza/prisma';
import { BranchService } from './services/branch.service';
import { CatalogService, CreateProductInput, UpdateProductInput } from './services/catalog.service';
import { DeliveryZoneService } from './services/delivery-zone.service';
import { PricingService } from './services/pricing.service';
import { ProductQueryDto } from './dto/product-query.dto';

@Controller()
export class ProductsController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly pricing: PricingService,
    private readonly branches: BranchService,
    private readonly zones: DeliveryZoneService,
  ) {}

  // ── Delivery zones ───────────────────────────────────────────

  /** Asked by orders at checkout, and by the client to quote a fee. */
  @MessagePattern(PRODUCTS_PATTERNS.RESOLVE_DELIVERY_ZONE)
  resolveDeliveryZone(@Payload() payload: { lat: number; lng: number }) {
    return this.zones.resolve(payload.lat, payload.lng);
  }

  @MessagePattern(PRODUCTS_PATTERNS.ADMIN_LIST_ZONES)
  adminListZones() {
    return this.zones.adminList();
  }

  @MessagePattern(PRODUCTS_PATTERNS.ADMIN_CREATE_ZONE)
  adminCreateZone(@Payload() payload: Prisma.DeliveryZoneUncheckedCreateInput & { actorId?: string }) {
    const { actorId, ...data } = payload;
    return this.zones.create(data, actorId);
  }

  @MessagePattern(PRODUCTS_PATTERNS.ADMIN_UPDATE_ZONE)
  adminUpdateZone(
    @Payload() payload: { zoneId: string; data: Prisma.DeliveryZoneUncheckedUpdateInput; actorId?: string },
  ) {
    return this.zones.update(payload.zoneId, payload.data, payload.actorId);
  }

  // ── Branches ─────────────────────────────────────────────────

  @MessagePattern(PRODUCTS_PATTERNS.LIST_BRANCHES)
  listBranches() {
    return this.branches.list();
  }

  /** Asked by orders before accepting a collection at this branch. */
  @MessagePattern(PRODUCTS_PATTERNS.GET_ORDERABLE_BRANCH)
  getOrderableBranch(@Payload() payload: { branchId: string }) {
    return this.branches.getOrderable(payload.branchId);
  }

  @MessagePattern(PRODUCTS_PATTERNS.DEFAULT_DELIVERY_BRANCH)
  defaultDeliveryBranch() {
    return this.branches.defaultForDelivery();
  }

  @MessagePattern(PRODUCTS_PATTERNS.ADMIN_LIST_BRANCHES)
  adminListBranches() {
    return this.branches.adminList();
  }

  @MessagePattern(PRODUCTS_PATTERNS.ADMIN_CREATE_BRANCH)
  adminCreateBranch(@Payload() payload: Prisma.BranchUncheckedCreateInput & { actorId?: string }) {
    const { actorId, ...data } = payload;
    return this.branches.create(data, actorId);
  }

  @MessagePattern(PRODUCTS_PATTERNS.ADMIN_UPDATE_BRANCH)
  adminUpdateBranch(
    @Payload() payload: { branchId: string; data: Prisma.BranchUncheckedUpdateInput; actorId?: string },
  ) {
    return this.branches.update(payload.branchId, payload.data, payload.actorId);
  }

  @MessagePattern(PRODUCTS_PATTERNS.LIST_CATEGORIES)
  listCategories() {
    return this.catalog.listCategories();
  }

  @MessagePattern(PRODUCTS_PATTERNS.LIST_DOUGH_TYPES)
  listDoughTypes() {
    return this.catalog.listDoughTypes();
  }

  @MessagePattern(PRODUCTS_PATTERNS.LIST_INGREDIENTS)
  listIngredients() {
    return this.catalog.listIngredients();
  }

  @MessagePattern(PRODUCTS_PATTERNS.LIST_PRODUCTS)
  listProducts(@Payload() query: ProductQueryDto) {
    return this.catalog.listProducts(query);
  }

  @MessagePattern(PRODUCTS_PATTERNS.GET_PRODUCT)
  getProduct(@Payload() payload: { slugOrId: string }) {
    return this.catalog.getProduct(payload.slugOrId);
  }

  @MessagePattern(PRODUCTS_PATTERNS.PRICE_PIZZA)
  pricePizza(@Payload() payload: { config: PizzaConfigDto; quantity: number }) {
    return this.pricing.priceOne(payload.config, payload.quantity);
  }

  /**
   * Re-prices a whole cart for the orders service. Returns the lines it could
   * price plus the ones it could not, so a delisted product drops out of the
   * cart instead of breaking every read of it.
   */
  @MessagePattern(PRODUCTS_PATTERNS.VALIDATE_ORDER_ITEMS)
  validateOrderItems(@Payload() payload: { items: ConfiguredItemDto[] }) {
    return this.pricing.priceItems(payload.items);
  }

  @MessagePattern(PRODUCTS_PATTERNS.RECOMMENDATIONS)
  recommendations(@Payload() payload: { userId: string | null; limit?: number }) {
    return this.catalog.recommendations(payload.userId, payload.limit);
  }

  // ── Favorites ────────────────────────────────────────────────

  @MessagePattern(PRODUCTS_PATTERNS.LIST_FAVORITES)
  listFavorites(@Payload() payload: { userId: string }) {
    return this.catalog.listFavorites(payload.userId);
  }

  @MessagePattern(PRODUCTS_PATTERNS.ADD_FAVORITE)
  addFavorite(@Payload() payload: { userId: string; productId: string }) {
    return this.catalog.addFavorite(payload.userId, payload.productId);
  }

  @MessagePattern(PRODUCTS_PATTERNS.REMOVE_FAVORITE)
  removeFavorite(@Payload() payload: { userId: string; productId: string }) {
    return this.catalog.removeFavorite(payload.userId, payload.productId);
  }

  // ── Admin ────────────────────────────────────────────────────

  @MessagePattern(PRODUCTS_PATTERNS.ADMIN_CREATE_CATEGORY)
  createCategory(
    @Payload() payload: { name: string; slug: string; description?: string; sortOrder?: number; actorId?: string },
  ) {
    const { actorId, ...data } = payload;
    return this.catalog.createCategory(data, actorId);
  }

  @MessagePattern(PRODUCTS_PATTERNS.ADMIN_CREATE_PRODUCT)
  createProduct(
    @Payload()
    payload: CreateProductInput & { actorId?: string },
  ) {
    const { actorId, ...data } = payload;
    return this.catalog.createProduct(data, actorId);
  }

  @MessagePattern(PRODUCTS_PATTERNS.ADMIN_UPDATE_PRODUCT)
  updateProduct(
    @Payload() payload: { productId: string; data: UpdateProductInput; actorId?: string },
  ) {
    return this.catalog.updateProduct(payload.productId, payload.data, payload.actorId);
  }

  @MessagePattern(PRODUCTS_PATTERNS.ADMIN_SET_PRODUCT_STOPPED)
  setProductStopped(
    @Payload() payload: { productId: string; stoppedUntil: string | null; actorId?: string },
  ) {
    return this.catalog.setStopped(
      payload.productId,
      payload.stoppedUntil ? new Date(payload.stoppedUntil) : null,
      payload.actorId,
    );
  }

  @MessagePattern(PRODUCTS_PATTERNS.ADMIN_LIST_STOPPED)
  listStopped() {
    return this.catalog.listStopped();
  }

  @MessagePattern(PRODUCTS_PATTERNS.ADMIN_DELETE_PRODUCT)
  deleteProduct(@Payload() payload: { productId: string; actorId?: string }) {
    return this.catalog.deleteProduct(payload.productId, payload.actorId);
  }
}
