import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/api-client';
import { createTestQueryClient } from '@/test/utils';
import { userApi } from './api';
import {
  useAddresses,
  useCreateAddress,
  useCurrentUser,
  useDeleteAddress,
  useLoyalty,
  useReferrals,
  useUpdateProfile,
  userKeys,
} from './queries';

vi.mock('./api', () => ({
  userApi: {
    me: vi.fn(),
    updateProfile: vi.fn(),
    listAddresses: vi.fn(),
    createAddress: vi.fn(),
    updateAddress: vi.fn(),
    deleteAddress: vi.fn(),
    loyalty: vi.fn(),
    referrals: vi.fn(),
  },
}));

const USER = { id: 'user-1', firstName: 'Амина', role: 'USER' };

function setup() {
  const queryClient = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(userApi.me).mockResolvedValue(USER as never);
  vi.mocked(userApi.listAddresses).mockResolvedValue([{ id: 'addr-1' }] as never);
  vi.mocked(userApi.loyalty).mockResolvedValue({ points: 420 } as never);
  vi.mocked(userApi.referrals).mockResolvedValue({ invited: 2 } as never);
});

describe('useCurrentUser', () => {
  it('returns the signed-in customer', async () => {
    const { wrapper } = setup();

    const { result } = renderHook(() => useCurrentUser(), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual(USER));
  });

  it('treats a 401 as "signed out", not as an error', async () => {
    vi.mocked(userApi.me).mockRejectedValue(new ApiError('Unauthorized', 401));
    const { wrapper } = setup();

    const { result } = renderHook(() => useCurrentUser(), { wrapper });

    // Otherwise every guest page would render an error boundary.
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('still surfaces a real failure', async () => {
    vi.mocked(userApi.me).mockRejectedValue(new ApiError('Bad gateway', 502));
    const { wrapper } = setup();

    const { result } = renderHook(() => useCurrentUser(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('does not retry the session probe', async () => {
    vi.mocked(userApi.me).mockRejectedValue(new ApiError('Bad gateway', 502));
    const { wrapper } = setup();

    const { result } = renderHook(() => useCurrentUser(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(userApi.me).toHaveBeenCalledTimes(1);
  });
});

describe('user-scoped queries', () => {
  it.each([
    ['addresses', useAddresses, 'listAddresses'],
    ['loyalty', useLoyalty, 'loyalty'],
    ['referrals', useReferrals, 'referrals'],
  ])('fetches %s once a session exists', async (_label, hook, method) => {
    const { wrapper } = setup();

    const { result } = renderHook(() => hook(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(userApi[method as 'listAddresses']).toHaveBeenCalled();
  });

  it.each([
    ['addresses', useAddresses, 'listAddresses'],
    ['loyalty', useLoyalty, 'loyalty'],
    ['referrals', useReferrals, 'referrals'],
  ])('does not fetch %s for a guest', async (_label, hook, method) => {
    vi.mocked(userApi.me).mockRejectedValue(new ApiError('Unauthorized', 401));
    const { wrapper } = setup();

    renderHook(() => hook(), { wrapper });

    await waitFor(() => expect(userApi.me).toHaveBeenCalled());
    expect(userApi[method as 'listAddresses']).not.toHaveBeenCalled();
  });
});

describe('address mutations', () => {
  it('refetches the list after creating an address', async () => {
    vi.mocked(userApi.createAddress).mockResolvedValue({ id: 'addr-2' } as never);
    const { wrapper, queryClient } = setup();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useCreateAddress(), { wrapper });
    result.current.mutate({ title: 'Дом', street: 'Ленина', house: '1' } as never);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: userKeys.addresses });
  });

  it('refetches the list after deleting an address', async () => {
    vi.mocked(userApi.deleteAddress).mockResolvedValue({ success: true } as never);
    const { wrapper, queryClient } = setup();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useDeleteAddress(), { wrapper });
    result.current.mutate('addr-1');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(userApi.deleteAddress).toHaveBeenCalledWith('addr-1');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: userKeys.addresses });
  });
});

describe('useUpdateProfile', () => {
  it('writes the updated user into the session cache', async () => {
    const updated = { ...USER, firstName: 'Патимат' };
    vi.mocked(userApi.updateProfile).mockResolvedValue(updated as never);
    const { wrapper, queryClient } = setup();

    const { result } = renderHook(() => useUpdateProfile(), { wrapper });
    result.current.mutate({ firstName: 'Патимат' });

    // The header greeting must update without a refetch.
    await waitFor(() => expect(queryClient.getQueryData(userKeys.me)).toEqual(updated));
  });
});
