import { Body, Controller, Delete, Get, Inject, Param, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientProxy } from '@nestjs/microservices';
import {
  CurrentUser,
  JwtPayload,
  ORDERS_PATTERNS,
  PRODUCTS_PATTERNS,
  Public,
  rpcSend,
} from '@chicago-pizza/common';
import { PriceItemBodyDto, ProductQueryDto, RecentReviewsQueryDto } from '../dto/catalog.dto';

@ApiTags('catalog')
@Controller()
export class CatalogController {
  constructor(
    @Inject('PRODUCTS_SERVICE') private readonly products: ClientProxy,
    @Inject('ORDERS_SERVICE') private readonly orders: ClientProxy,
  ) {}

  @Public()
  @Get('categories')
  @ApiOperation({ summary: 'Список категорий' })
  listCategories() {
    return rpcSend(this.products, PRODUCTS_PATTERNS.LIST_CATEGORIES, {});
  }

  @Public()
  @Get('dough-types')
  @ApiOperation({ summary: 'Виды теста' })
  listDoughTypes() {
    return rpcSend(this.products, PRODUCTS_PATTERNS.LIST_DOUGH_TYPES, {});
  }

  @Public()
  @Get('ingredients')
  @ApiOperation({ summary: 'Все ингредиенты для конструктора' })
  listIngredients() {
    return rpcSend(this.products, PRODUCTS_PATTERNS.LIST_INGREDIENTS, {});
  }

  @Public()
  @Get('products')
  @ApiOperation({ summary: 'Каталог с фильтрами, поиском и пагинацией' })
  listProducts(@Query() query: ProductQueryDto) {
    return rpcSend(this.products, PRODUCTS_PATTERNS.LIST_PRODUCTS, query);
  }

  @Public()
  @Get('products/:slugOrId')
  @ApiOperation({ summary: 'Карточка товара' })
  getProduct(@Param('slugOrId') slugOrId: string) {
    return rpcSend(this.products, PRODUCTS_PATTERNS.GET_PRODUCT, { slugOrId });
  }

  @Public()
  @Post('products/price')
  @ApiOperation({ summary: 'Рассчитать цену собранной пиццы (для live-превью в конструкторе)' })
  price(@Body() dto: PriceItemBodyDto) {
    return rpcSend(this.products, PRODUCTS_PATTERNS.PRICE_PIZZA, {
      config: dto.config,
      quantity: dto.quantity,
    });
  }

  @Public()
  @Get('reviews')
  @ApiOperation({ summary: 'Последние отзывы о доставленных заказах (для главной)' })
  recentReviews(@Query() query: RecentReviewsQueryDto) {
    // Reviews rate an order, so they live in the orders service; the catalog
    // controller simply exposes them where the marketing page needs them.
    return rpcSend(this.orders, ORDERS_PATTERNS.LIST_RECENT_REVIEWS, { limit: query.limit });
  }

  @Public()
  @Get('recommendations')
  @ApiOperation({ summary: 'Персональные рекомендации (или популярное для гостя)' })
  recommendations(@CurrentUser() user: JwtPayload | undefined) {
    return rpcSend(this.products, PRODUCTS_PATTERNS.RECOMMENDATIONS, { userId: user?.sub ?? null });
  }

  // ── Favorites ────────────────────────────────────────────────

  @ApiCookieAuth()
  @Get('favorites')
  listFavorites(@CurrentUser() user: JwtPayload) {
    return rpcSend(this.products, PRODUCTS_PATTERNS.LIST_FAVORITES, { userId: user.sub });
  }

  @ApiCookieAuth()
  @Post('favorites/:productId')
  addFavorite(@CurrentUser() user: JwtPayload, @Param('productId') productId: string) {
    return rpcSend(this.products, PRODUCTS_PATTERNS.ADD_FAVORITE, { userId: user.sub, productId });
  }

  @ApiCookieAuth()
  @Delete('favorites/:productId')
  removeFavorite(@CurrentUser() user: JwtPayload, @Param('productId') productId: string) {
    return rpcSend(this.products, PRODUCTS_PATTERNS.REMOVE_FAVORITE, { userId: user.sub, productId });
  }
}
