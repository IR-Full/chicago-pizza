import { api } from '@/shared/api/api-client';
import type {
  Category,
  DoughType,
  Ingredient,
  Paginated,
  PizzaConfig,
  PricedItem,
  Product,
  RecentReview,
} from '@/shared/api/types';

export interface ProductFilters {
  categorySlug?: string;
  search?: string;
  isVegetarian?: boolean;
  isSpicy?: boolean;
  isNew?: boolean;
  isPopular?: boolean;
  page?: number;
  limit?: number;
}

/**
 * The menu changes a few times a week at most. Caching it for five minutes
 * keeps the home page a real ISR route instead of re-rendering per visitor.
 */
const CATALOG_TTL = 300;

export const productApi = {
  categories: () => api.get<Category[]>('/categories', { revalidate: CATALOG_TTL }),
  doughTypes: () => api.get<DoughType[]>('/dough-types', { revalidate: CATALOG_TTL }),
  ingredients: () => api.get<Ingredient[]>('/ingredients', { revalidate: CATALOG_TTL }),

  list: (filters: ProductFilters = {}) =>
    api.get<Paginated<Product>>('/products', {
      query: {
        categorySlug: filters.categorySlug,
        search: filters.search,
        isVegetarian: filters.isVegetarian,
        isSpicy: filters.isSpicy,
        isNew: filters.isNew,
        isPopular: filters.isPopular,
        page: filters.page,
        limit: filters.limit,
      },
      revalidate: CATALOG_TTL,
    }),

  get: (slugOrId: string) => api.get<Product>(`/products/${slugOrId}`, { revalidate: CATALOG_TTL }),

  /** Latest four- and five-star reviews, for the home page testimonials. */
  recentReviews: (limit = 3) =>
    api.get<RecentReview[]>('/reviews', { query: { limit }, revalidate: CATALOG_TTL }),

  /** Server-side price for a configured pizza — drives the live price preview. */
  price: (config: PizzaConfig, quantity = 1) =>
    api.post<PricedItem>('/products/price', { config, quantity }),

  recommendations: () => api.get<Product[]>('/recommendations'),

  favorites: () => api.get<Product[]>('/favorites'),
  addFavorite: (productId: string) => api.post<{ success: boolean }>(`/favorites/${productId}`),
  removeFavorite: (productId: string) => api.delete<{ success: boolean }>(`/favorites/${productId}`),
};
