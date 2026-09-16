import { api } from '@/shared/api/api-client';
import type { AppliedPromocode, Cart, PizzaConfig } from '@/shared/api/types';

export const cartApi = {
  get: () => api.get<Cart>('/cart'),
  addItem: (config: PizzaConfig, quantity = 1) => api.post<Cart>('/cart/items', { config, quantity }),
  updateItem: (lineId: string, quantity: number) => api.patch<Cart>(`/cart/items/${lineId}`, { quantity }),
  removeItem: (lineId: string) => api.delete<Cart>(`/cart/items/${lineId}`),
  clear: () => api.delete<Cart>('/cart'),
  checkPromocode: (code: string) => api.post<AppliedPromocode>('/cart/promocode', { code }),
};
