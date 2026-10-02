'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { userKeys } from '@/entities/user/queries';
import { cartApi } from '@/entities/cart/api';
import { cartKeys } from '@/entities/cart/queries';
import { guestCart } from '@/entities/cart/guest-cart';
import { disconnectSocket } from '@/shared/api/socket';
import { authApi, type RegisterPayload } from '../api';

/**
 * Carries whatever the visitor put in their basket before signing in over to
 * their account.
 *
 * Runs after the session exists and before anything else reads the cart. A
 * failure here must not fail the sign-in — the customer is in, and their
 * browser cart is still where they left it, so the next sign-in tries again.
 */
async function adoptGuestCart(
  qc: ReturnType<typeof useQueryClient>,
  userId: string,
): Promise<void> {
  const lines = guestCart.lines();
  if (!lines.length) return;

  try {
    const cart = await cartApi.merge(lines);
    // Cleared only once the server has taken them.
    guestCart.clear();
    qc.setQueryData(cartKeys.cart(userId), cart);
  } catch {
    // Keep the basket; the merge is retried on the next sign-in.
  }
}

export function useLogin() {
  const qc = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) => authApi.login(email, password),
    onSuccess: async ({ user }) => {
      qc.setQueryData(userKeys.me, user);
      // Everything user-scoped (cart, orders, favorites) belongs to someone
      // else now — drop it rather than showing stale data.
      qc.invalidateQueries();
      // The socket this tab has been holding was opened as a guest, and the
      // gateway closed it on the spot: a connection with no valid token is
      // disconnected during the handshake. Socket.IO then spends its ten
      // reconnection attempts and gives up — so by the time anyone signs in,
      // the shared socket is usually dead for good, and live order tracking
      // silently did nothing until the page happened to be reloaded. Dropping
      // it here means the next `getSocket()` dials again, now with a cookie.
      disconnectSocket();
      // After the invalidation, so the merged cart is not thrown away again.
      await adoptGuestCart(qc, user.id);
      router.refresh();
    },
  });
}

export function useRegister() {
  return useMutation({ mutationFn: (payload: RegisterPayload) => authApi.register(payload) });
}

export function useLogout() {
  const qc = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: authApi.logout,
    onSuccess: () => {
      qc.setQueryData(userKeys.me, null);
      qc.clear();
      // The socket authenticated once, at connection time, and then lived on:
      // signing out cleared the cookies and the cache but left it sitting in
      // `user:<the previous id>`, still receiving that person's order pushes
      // and notification nudges. On a shared machine the next visitor got them.
      // Only a block or a role change dropped sockets server-side; an ordinary
      // logout has to close its own.
      disconnectSocket();
      router.push('/');
      router.refresh();
    },
  });
}

export function useVerifyEmail() {
  return useMutation({
    mutationFn: ({ email, code }: { email: string; code: string }) => authApi.verifyEmail(email, code),
  });
}

export function useResendVerification() {
  return useMutation({ mutationFn: (email: string) => authApi.resendVerification(email) });
}

export function useForgotPassword() {
  return useMutation({ mutationFn: (email: string) => authApi.forgotPassword(email) });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: ({ token, newPassword }: { token: string; newPassword: string }) =>
      authApi.resetPassword(token, newPassword),
  });
}
