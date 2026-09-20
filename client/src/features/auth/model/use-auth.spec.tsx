import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestQueryClient } from '@/test/utils';
import { userKeys } from '@/entities/user/queries';
import { authApi } from '../api';
import {
  useForgotPassword,
  useLogin,
  useLogout,
  useRegister,
  useResendVerification,
  useResetPassword,
  useVerifyEmail,
} from './use-auth';

const router = { refresh: vi.fn(), push: vi.fn() };

vi.mock('next/navigation', () => ({ useRouter: () => router }));

vi.mock('../api', () => ({
  authApi: {
    register: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    verifyEmail: vi.fn(),
    resendVerification: vi.fn(),
    forgotPassword: vi.fn(),
    resetPassword: vi.fn(),
  },
}));

const USER = { id: 'user-1', firstName: 'Амина' };

function setup() {
  const queryClient = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authApi.login).mockResolvedValue({ user: USER } as never);
  vi.mocked(authApi.register).mockResolvedValue({ user: USER } as never);
  vi.mocked(authApi.logout).mockResolvedValue({ success: true } as never);
  vi.mocked(authApi.verifyEmail).mockResolvedValue({ verified: true } as never);
  vi.mocked(authApi.resendVerification).mockResolvedValue({ sent: true } as never);
  vi.mocked(authApi.forgotPassword).mockResolvedValue({ sent: true } as never);
  vi.mocked(authApi.resetPassword).mockResolvedValue({ success: true } as never);
});

describe('useLogin', () => {
  it('seeds the session cache so the header updates immediately', async () => {
    const { wrapper, queryClient } = setup();

    const { result } = renderHook(() => useLogin(), { wrapper });
    result.current.mutate({ email: 'a@b.ru', password: 'Password1' });

    await waitFor(() => expect(queryClient.getQueryData(userKeys.me)).toEqual(USER));
    expect(authApi.login).toHaveBeenCalledWith('a@b.ru', 'Password1');
  });

  it('drops every cached query — the data belonged to whoever was signed in before', async () => {
    const { wrapper, queryClient } = setup();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useLogin(), { wrapper });
    result.current.mutate({ email: 'a@b.ru', password: 'Password1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidate).toHaveBeenCalledWith();
  });

  it('refreshes the server components so SSR pages see the session', async () => {
    const { wrapper } = setup();

    const { result } = renderHook(() => useLogin(), { wrapper });
    result.current.mutate({ email: 'a@b.ru', password: 'Password1' });

    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it('leaves the cache untouched on bad credentials', async () => {
    vi.mocked(authApi.login).mockRejectedValue(new Error('Invalid email or password'));
    const { wrapper, queryClient } = setup();

    const { result } = renderHook(() => useLogin(), { wrapper });
    result.current.mutate({ email: 'a@b.ru', password: 'nope' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(queryClient.getQueryData(userKeys.me)).toBeUndefined();
    expect(router.refresh).not.toHaveBeenCalled();
  });
});

describe('useLogout', () => {
  it('clears the cache and sends the visitor home', async () => {
    const { wrapper, queryClient } = setup();
    const clear = vi.spyOn(queryClient, 'clear');

    const { result } = renderHook(() => useLogout(), { wrapper });
    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(clear).toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith('/');
    expect(router.refresh).toHaveBeenCalled();
  });
});

describe('useRegister', () => {
  it('registers without signing the visitor in — email must be verified first', async () => {
    const { wrapper, queryClient } = setup();
    const payload = {
      email: 'a@b.ru',
      password: 'Password1',
      firstName: 'Амина',
      // The API refuses a signup without recorded consent (152-ФЗ).
      acceptPrivacyPolicy: true as const,
    };

    const { result } = renderHook(() => useRegister(), { wrapper });
    result.current.mutate(payload);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(authApi.register).toHaveBeenCalledWith(payload);
    expect(queryClient.getQueryData(userKeys.me)).toBeUndefined();
  });
});

describe('the remaining account mutations', () => {
  it('verifies an email by address and code', async () => {
    const { wrapper } = setup();

    const { result } = renderHook(() => useVerifyEmail(), { wrapper });
    result.current.mutate({ email: 'a@b.ru', code: '123456' });

    await waitFor(() => expect(authApi.verifyEmail).toHaveBeenCalledWith('a@b.ru', '123456'));
  });

  it('resends a verification code', async () => {
    const { wrapper } = setup();

    const { result } = renderHook(() => useResendVerification(), { wrapper });
    result.current.mutate('a@b.ru');

    await waitFor(() => expect(authApi.resendVerification).toHaveBeenCalledWith('a@b.ru'));
  });

  it('requests a password reset', async () => {
    const { wrapper } = setup();

    const { result } = renderHook(() => useForgotPassword(), { wrapper });
    result.current.mutate('a@b.ru');

    await waitFor(() => expect(authApi.forgotPassword).toHaveBeenCalledWith('a@b.ru'));
  });

  it('completes a password reset with the emailed token', async () => {
    const { wrapper } = setup();

    const { result } = renderHook(() => useResetPassword(), { wrapper });
    result.current.mutate({ token: 'tok', newPassword: 'NewPass1' });

    await waitFor(() => expect(authApi.resetPassword).toHaveBeenCalledWith('tok', 'NewPass1'));
  });
});
