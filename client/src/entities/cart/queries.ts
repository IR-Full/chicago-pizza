'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Cart, PizzaConfig } from '@/shared/api/types';
import { useCurrentUser } from '@/entities/user/queries';
import { cartApi } from './api';

export const cartKeys = {
  cart: ['cart'] as const,
};

const EMPTY_CART: Cart = { lines: [], subtotal: 0, itemCount: 0 };

export function useCart() {
  const { data: user } = useCurrentUser();
  return useQuery({
    queryKey: cartKeys.cart,
    queryFn: cartApi.get,
    // The cart lives server-side in Redis, so it only exists for signed-in
    // users. Guests see an empty cart until they sign in.
    enabled: !!user,
    placeholderData: EMPTY_CART,
  });
}

export function useAddToCart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ config, quantity }: { config: PizzaConfig; quantity: number }) =>
      cartApi.addItem(config, quantity),
    onSuccess: (cart) => qc.setQueryData(cartKeys.cart, cart),
  });
}

export function useUpdateCartItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ lineId, quantity }: { lineId: string; quantity: number }) =>
      cartApi.updateItem(lineId, quantity),
    onSuccess: (cart) => qc.setQueryData(cartKeys.cart, cart),
  });
}

export function useRemoveCartItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (lineId: string) => cartApi.removeItem(lineId),
    onSuccess: (cart) => qc.setQueryData(cartKeys.cart, cart),
  });
}

export function useClearCart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: cartApi.clear,
    onSuccess: (cart) => qc.setQueryData(cartKeys.cart, cart),
  });
}

export function useCheckPromocode() {
  return useMutation({ mutationFn: (code: string) => cartApi.checkPromocode(code) });
}
