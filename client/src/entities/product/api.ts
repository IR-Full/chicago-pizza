import { api } from '@/shared/api/api-client';
import type {
  Category,
  DoughType,
  Ingredient,
  Paginated,
  PizzaConfig,
  PricedItem,
  Product,
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

export const productApi = {
  categories: () => api.get<Category[]>('/categories'),
  doughTypes: () => api.get<DoughType[]>('/dough-types'),
  ingredients: () => api.get<Ingredient[]>('/ingredients'),

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
    }),

  get: (slugOrId: string) => api.get<Product>(`/products/${slugOrId}`),

  /** Server-side price for a configured pizza — drives the live price preview. */
  price: (config: PizzaConfig, quantity = 1) =>
    api.post<PricedItem>('/products/price', { config, quantity }),

  recommendations: () => api.get<Product[]>('/recommendations'),

  favorites: () => api.get<Product[]>('/favorites'),
  addFavorite: (productId: string) => api.post<{ success: boolean }>(`/favorites/${productId}`),
  removeFavorite: (productId: string) => api.delete<{ success: boolean }>(`/favorites/${productId}`),
};
