import { api } from '@/shared/api/api-client';
import type { AppliedPromocode, Cart, PizzaConfig } from '@/shared/api/types';
import type { GuestCartLine } from './guest-cart';

export const cartApi = {
  get: () => api.get<Cart>('/cart'),
  addItem: (config: PizzaConfig, quantity = 1) => api.post<Cart>('/cart/items', { config, quantity }),
  updateItem: (lineId: string, quantity: number) => api.patch<Cart>(`/cart/items/${lineId}`, { quantity }),
  removeItem: (lineId: string) => api.delete<Cart>(`/cart/items/${lineId}`),
  clear: () => api.delete<Cart>('/cart'),
  checkPromocode: (code: string) => api.post<AppliedPromocode>('/cart/promocode', { code }),

  /**
   * Values a cart that lives in the browser. Nothing is stored — the prices
   * still come from the server, because the browser is not a trustworthy
   * place to decide what a pizza costs.
   */
  preview: (lines: GuestCartLine[]) => api.post<Cart>('/cart/preview', { lines }),

  /** Folds the browser cart into the account's one, right after signing in. */
  merge: (lines: GuestCartLine[]) => api.post<Cart>('/cart/merge', { lines }),
};
