import { api } from '@/shared/api/api-client';
import type { User } from '@/shared/api/types';

export interface RegisterPayload {
  email: string;
  password: string;
  firstName: string;
  lastName?: string;
  phone?: string;
  referralCode?: string;
}

export const authApi = {
  register: (payload: RegisterPayload) => api.post<{ user: User }>('/auth/register', payload),
  login: (email: string, password: string) => api.post<{ user: User }>('/auth/login', { email, password }),
  logout: () => api.post<{ success: boolean }>('/auth/logout'),
  verifyEmail: (email: string, code: string) =>
    api.post<{ verified: boolean }>('/auth/verify-email', { email, code }),
  resendVerification: (email: string) => api.post<{ sent: boolean }>('/auth/resend-verification', { email }),
  forgotPassword: (email: string) => api.post<{ sent: boolean }>('/auth/forgot-password', { email }),
  resetPassword: (token: string, newPassword: string) =>
    api.post<{ success: boolean }>('/auth/reset-password', { token, newPassword }),
};
