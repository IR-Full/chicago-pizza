'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { userKeys } from '@/entities/user/queries';
import { authApi, type RegisterPayload } from '../api';

export function useLogin() {
  const qc = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) => authApi.login(email, password),
    onSuccess: ({ user }) => {
      qc.setQueryData(userKeys.me, user);
      // Everything user-scoped (cart, orders, favorites) belongs to someone
      // else now — drop it rather than showing stale data.
      qc.invalidateQueries();
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
