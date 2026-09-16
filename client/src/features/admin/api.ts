import { api } from '@/shared/api/api-client';
import type {
  DiscountType,
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
  updateOrderStatus: (orderId: string, status: OrderStatus) =>
    api.patch<Order>(`/admin/orders/${orderId}/status`, { status }),

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

  deleteProduct: (productId: string) => api.delete<{ success: boolean }>(`/admin/products/${productId}`),
};
