import { api } from '@/shared/api/api-client';
import type {
  AnalyticsSummary,
  DiscountType,
  Product,
  Order,
  OrderStatus,
  Paginated,
  Promocode,
  Role,
  SupportTicket,
  TicketStatus,
  User,
} from '@/shared/api/types';

export const adminApi = {
  listOrders: (page = 1, status?: OrderStatus) =>
    api.get<Paginated<Order>>('/admin/orders', { query: { page, status } }),

  /**
   * The kitchen board: one branch, and only what is still in play. A board
   * carrying yesterday's delivered orders is a board nobody reads.
   */
  listKitchenOrders: (branchId?: string, limit = 100) =>
    api.get<Paginated<Order>>('/admin/orders', { query: { branchId, liveOnly: true, limit } }),
  updateOrderStatus: (orderId: string, status: OrderStatus) =>
    api.patch<Order>(`/admin/orders/${orderId}/status`, { status }),

  /**
   * The owner's report over the last `days`. The window is resolved on the
   * server, which is where the default and the cap are stated.
   */
  analytics: (days: number, branchId?: string) =>
    api.get<AnalyticsSummary>('/admin/analytics', {
      query: {
        from: new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString(),
        branchId,
      },
    }),

  listPromocodes: () => api.get<Promocode[]>('/admin/promocodes'),
  createPromocode: (data: {
    code: string;
    discountType: DiscountType;
    discountValue: number;
    minOrderAmount?: number;
    maxUses?: number;
    expiresAt?: string;
  }) => api.post<Promocode>('/admin/promocodes', data),

  listUsers: (page = 1, search?: string) =>
    api.get<Paginated<User>>('/admin/users', { query: { page, search } }),
  setUserRole: (userId: string, role: Role) => api.patch<User>(`/admin/users/${userId}/role`, { role }),
  setUserBlocked: (userId: string, isBlocked: boolean) =>
    api.patch<User>(`/admin/users/${userId}/blocked`, { isBlocked }),

  listTickets: (page = 1, status?: TicketStatus) =>
    api.get<Paginated<SupportTicket>>('/admin/tickets', { query: { page, status } }),

  /**
   * Creating and editing a product, flavours included.
   *
   * There is no product-editor screen in the panel — the menu is managed by the
   * seed script and the API — so for now these exist to make the flavour list
   * reachable at all: it was previously settable *only* by re-running the seed,
   * even though the picker, the pricing rule and the order snapshot were all in
   * place. `variants` replaces the stored list; omit it to leave the flavours
   * alone, and send `[]` to say a product has none.
   */
  createProduct: (data: {
    name: string;
    slug: string;
    categoryId: string;
    type: Product['type'];
    description?: string;
    basePrice?: number;
    sizes?: { sizeCm: number; label: string; price: number }[];
    variants?: { name: string; slug: string; sortOrder?: number }[];
  }) => api.post<Product>('/admin/products', data),

  updateProduct: (
    productId: string,
    data: {
      name?: string;
      description?: string;
      basePrice?: number;
      isActive?: boolean;
      variants?: { name: string; slug: string; sortOrder?: number }[];
    },
  ) => api.patch<Product>(`/admin/products/${productId}`, data),

  deleteProduct: (productId: string) => api.delete<{ success: boolean }>(`/admin/products/${productId}`),

  /** What the kitchen has taken off the menu right now. */
  listStopped: () => api.get<Product[]>('/admin/stop-list'),
  /**
   * Pauses an item for `minutes`, or puts it back when given 0.
   *
   * A duration rather than a moment: the server turns it into a timestamp on
   * its own clock, so a staff tablet with the wrong time cannot bring an item
   * back early — or leave it off for a day.
   */
  stopProduct: (productId: string, minutes: number) =>
    api.patch<Product>(`/admin/products/${productId}/stop`, { minutes }),
};
