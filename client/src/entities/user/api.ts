import { api } from '@/shared/api/api-client';
import type { Address, LoyaltySummary, ReferralInfo, User } from '@/shared/api/types';

export const userApi = {
  me: () => api.get<User>('/auth/me'),
  updateProfile: (data: Partial<Pick<User, 'firstName' | 'lastName' | 'darkThemeEnabled' | 'locale'>>) =>
    api.patch<User>('/auth/me', data),

  listAddresses: () => api.get<Address[]>('/auth/addresses'),
  createAddress: (data: Omit<Address, 'id'>) => api.post<Address>('/auth/addresses', data),
  updateAddress: (id: string, data: Partial<Omit<Address, 'id'>>) =>
    api.patch<Address>(`/auth/addresses/${id}`, data),
  deleteAddress: (id: string) => api.delete<{ success: boolean }>(`/auth/addresses/${id}`),

  loyalty: () => api.get<LoyaltySummary>('/loyalty'),
  referrals: () => api.get<ReferralInfo>('/referrals'),
};
