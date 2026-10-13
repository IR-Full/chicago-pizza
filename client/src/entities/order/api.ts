import { api } from '@/shared/api/api-client';
import type {
  Cart,
  DeliveryType,
  FulfillmentType,
  Order,
  OrderPayment,
  Paginated,
  PaymentMethod,
} from '@/shared/api/types';

export interface CheckoutPayload {
  fulfillment: FulfillmentType;
  /** Required for a delivery; a collection has nowhere to be brought to. */
  addressId?: string;
  /** Required for a collection: which kitchen to pick it up from. */
  branchId?: string;
  deliveryType: DeliveryType;
  scheduledAt?: string;
  comment?: string;
  promocode?: string;
  redeemPoints?: number;
  paymentMethod: PaymentMethod;
}

export const orderApi = {
  /**
   * `idempotencyKey` identifies the *attempt*, not the request: every retry
   * of the same attempt carries it unchanged, and the server answers with the
   * order the first one created instead of placing a second.
   */
  checkout: (payload: CheckoutPayload, idempotencyKey?: string) =>
    api.post<Order>('/orders', payload, {
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
    }),
  list: (page = 1, limit = 20) => api.get<Paginated<Order>>('/orders', { query: { page, limit } }),
  get: (id: string) => api.get<Order>(`/orders/${id}`),
  repeat: (id: string) => api.post<Cart>(`/orders/${id}/repeat`),
  cancel: (id: string) => api.post<Order>(`/orders/${id}/cancel`),

  /** Whether the shop can take money online at all. */
  paymentEnabled: () => api.get<{ enabled: boolean }>('/payments/enabled'),
  /** Opens (or resumes) the payment and returns where to send the customer. */
  startPayment: (id: string) => api.post<{ confirmationUrl: string }>(`/orders/${id}/pay`),
  paymentStatus: (id: string) => api.get<OrderPayment>(`/orders/${id}/payment`),
  review: (id: string, rating: number, comment?: string) =>
    api.post<{ rating: number; comment: string | null }>(`/orders/${id}/review`, { rating, comment }),
};
