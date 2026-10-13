'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Cart, PizzaConfig } from '@/shared/api/types';
import { useCurrentUser } from '@/entities/user/queries';
import { cartApi } from './api';
import { guestCart, type GuestCartLine } from './guest-cart';

export const cartKeys = {
  /** Every cart in the cache, whoever it belongs to — for invalidation. */
  all: ['cart'] as const,
  /**
   * One identity's cart.
   *
   * A guest's basket and an account's are different baskets held by the same
   * hooks, and they used to share the key `['cart']`. Signing in put the
   * account's cart under the guest's entry, and signing out left the
   * account's cart on screen for the next visitor on that browser — with
   * `staleTime` deciding how long. Naming the owner is what keeps one
   * person's order off someone else's screen.
   */
  cart: (userId?: string | null) => ['cart', userId ?? 'guest'] as const,
};

const EMPTY_CART: Cart = {
  lines: [],
  subtotal: 0,
  itemCount: 0,
  // Placeholders until the real cart arrives with the server-side tariff;
  // nothing on screen quotes a delivery fee from these.
  deliveryFee: 0,
  freeDeliveryThreshold: 0,
  total: 0,
  removed: [],
};

/**
 * Prices whichever cart this visitor has.
 *
 * Signed in, that is the one in Redis. Signed out, it is the list in this
 * browser — sent to the server to be valued, never priced locally. Guests
 * could not have a cart at all before: adding a pizza required an account
 * first, which is the most expensive barrier a delivery shop can put up.
 */
export function useCart() {
  const { data: user } = useCurrentUser();

  return useQuery({
    queryKey: cartKeys.cart(user?.id),
    queryFn: () => (user ? cartApi.get() : cartApi.preview(guestCart.lines())),
    placeholderData: EMPTY_CART,
  });
}

/**
 * Runs a cart change against the account when there is one, and against the
 * browser when there is not, then writes the freshly priced cart into the
 * cache so the header count and the cart page move together.
 */
function useCartMutation<TVariables>(
  server: (variables: TVariables) => Promise<Cart>,
  local: (variables: TVariables) => GuestCartLine[],
) {
  const qc = useQueryClient();
  const { data: user } = useCurrentUser();

  return useMutation({
    mutationFn: (variables: TVariables) => (user ? server(variables) : cartApi.preview(local(variables))),
    onSuccess: (cart) => qc.setQueryData(cartKeys.cart(user?.id), cart),
  });
}

export function useAddToCart() {
  return useCartMutation(
    ({ config, quantity }: { config: PizzaConfig; quantity: number }) => cartApi.addItem(config, quantity),
    ({ config, quantity }) => guestCart.add(config, quantity),
  );
}

export function useUpdateCartItem() {
  return useCartMutation(
    ({ lineId, quantity }: { lineId: string; quantity: number }) => cartApi.updateItem(lineId, quantity),
    ({ lineId, quantity }) => guestCart.setQuantity(lineId, quantity),
  );
}

export function useRemoveCartItem() {
  return useCartMutation(
    (lineId: string) => cartApi.removeItem(lineId),
    (lineId) => guestCart.remove(lineId),
  );
}

export function useClearCart() {
  return useCartMutation(
    () => cartApi.clear(),
    () => guestCart.clear(),
  );
}

/**
 * Moves the browser cart into the account, right after signing in.
 *
 * Called on every successful sign-in and registration. An empty guest cart
 * short-circuits, so the ordinary "log in on a device I have used before"
 * path costs nothing.
 */
export function useMergeGuestCart() {
  const qc = useQueryClient();
  const { data: user } = useCurrentUser();

  return useMutation({
    mutationFn: async () => {
      const lines = guestCart.lines();
      if (!lines.length) return null;

      const cart = await cartApi.merge(lines);
      // Only after the server has taken them: a failed merge must leave the
      // customer's basket where it was, not throw it away.
      guestCart.clear();
      return cart;
    },
    onSuccess: (cart) => {
      if (cart) qc.setQueryData(cartKeys.cart(user?.id), cart);
    },
  });
}

export function useCheckPromocode() {
  return useMutation({ mutationFn: (code: string) => cartApi.checkPromocode(code) });
}
