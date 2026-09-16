import { api } from '@/shared/api/api-client';
import type { Cart, DeliveryType, Order, Paginated, PaymentMethod } from '@/shared/api/types';

export interface CheckoutPayload {
  addressId: string;
  deliveryType: DeliveryType;
  scheduledAt?: string;
  comment?: string;
  promocode?: string;
  redeemPoints?: number;
  paymentMethod: PaymentMethod;
}

export const orderApi = {
  checkout: (payload: CheckoutPayload) => api.post<Order>('/orders', payload),
  list: (page = 1, limit = 20) => api.get<Paginated<Order>>('/orders', { query: { page, limit } }),
  get: (id: string) => api.get<Order>(`/orders/${id}`),
  repeat: (id: string) => api.post<Cart>(`/orders/${id}/repeat`),
  review: (id: string, rating: number, comment?: string) =>
    api.post<{ rating: number; comment: string | null }>(`/orders/${id}/review`, { rating, comment }),
};
