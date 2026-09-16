'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cartKeys } from '@/entities/cart/queries';
import { useCurrentUser, userKeys } from '@/entities/user/queries';
import { orderApi, type CheckoutPayload } from './api';

export const orderKeys = {
  list: (page: number) => ['orders', 'list', page] as const,
  detail: (id: string) => ['orders', 'detail', id] as const,
};

export function useOrders(page = 1) {
  const { data: user } = useCurrentUser();
  return useQuery({
    queryKey: orderKeys.list(page),
    queryFn: () => orderApi.list(page),
    enabled: !!user,
  });
}

export function useOrder(id: string) {
  return useQuery({
    queryKey: orderKeys.detail(id),
    queryFn: () => orderApi.get(id),
    enabled: !!id,
  });
}

export function useCheckout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CheckoutPayload) => orderApi.checkout(payload),
    onSuccess: () => {
      // Checkout empties the cart and may have spent loyalty points.
      qc.invalidateQueries({ queryKey: cartKeys.cart });
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: userKeys.loyalty });
    },
  });
}

export function useRepeatOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => orderApi.repeat(id),
    onSuccess: (cart) => qc.setQueryData(cartKeys.cart, cart),
  });
}

export function useSubmitReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, rating, comment }: { id: string; rating: number; comment?: string }) =>
      orderApi.review(id, rating, comment),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: orderKeys.detail(variables.id) });
      qc.invalidateQueries({ queryKey: ['orders', 'list'] });
    },
  });
}
