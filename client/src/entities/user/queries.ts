'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/shared/api/api-client';
import type { Address, User } from '@/shared/api/types';
import { userApi } from './api';

export const userKeys = {
  me: ['user', 'me'] as const,
  addresses: ['user', 'addresses'] as const,
  loyalty: ['user', 'loyalty'] as const,
  referrals: ['user', 'referrals'] as const,
};

export function useCurrentUser() {
  return useQuery<User | null>({
    queryKey: userKeys.me,
    queryFn: async () => {
      try {
        return await userApi.me();
      } catch (error) {
        // A signed-out visitor is a normal state, not an error to surface.
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

export function useAddresses() {
  const { data: user } = useCurrentUser();
  return useQuery({
    queryKey: userKeys.addresses,
    queryFn: userApi.listAddresses,
    enabled: !!user,
  });
}

export function useCreateAddress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Omit<Address, 'id'>) => userApi.createAddress(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: userKeys.addresses }),
  });
}

export function useDeleteAddress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => userApi.deleteAddress(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: userKeys.addresses }),
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Pick<User, 'firstName' | 'lastName' | 'darkThemeEnabled' | 'locale'>>) =>
      userApi.updateProfile(data),
    onSuccess: (user) => qc.setQueryData(userKeys.me, user),
  });
}

export function useLoyalty() {
  const { data: user } = useCurrentUser();
  return useQuery({ queryKey: userKeys.loyalty, queryFn: userApi.loyalty, enabled: !!user });
}

export function useReferrals() {
  const { data: user } = useCurrentUser();
  return useQuery({ queryKey: userKeys.referrals, queryFn: userApi.referrals, enabled: !!user });
}
