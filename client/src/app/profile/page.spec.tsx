import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/utils';
import ProfilePage from './page';

const toast = { success: vi.fn(), error: vi.fn() };
const user = vi.fn(() => ({ data: USER as Record<string, unknown> | null, isLoading: false }));
const addresses = vi.fn(() => ({ data: [ADDRESS] as Record<string, unknown>[] }));
const loyalty = vi.fn(() => ({ data: LOYALTY as Record<string, unknown> | undefined }));
const referrals = vi.fn(() => ({ data: REFERRALS as Record<string, unknown> | undefined }));
const favorites = vi.fn(() => ({ data: [] as Record<string, unknown>[] }));
const deleteAddress = { mutate: vi.fn(), isPending: false };
const toggleFavorite = { mutate: vi.fn(), isPending: false };

const USER = { id: 'user-1', firstName: 'Амина', lastName: 'Магомедова', email: 'guest@chicago.ru', phone: '+79280000000', isEmailVerified: true };
const ADDRESS = { id: 'addr-1', title: 'Дом', city: 'Махачкала', street: 'Ленина', house: '1', apartment: '5' };
const LOYALTY = { points: 420, level: 'SILVER', cashbackPercent: 7, lifetimeSpend: 150000, nextLevel: { level: 'GOLD', remaining: 150000 } };
const REFERRALS = { referralCode: 'AABBCCDD', bonusPerReferral: 300, invited: 2, rewarded: 1, referrals: [] };

vi.mock('sonner', () => ({
  toast: { success: (...a: unknown[]) => toast.success(...a), error: (...a: unknown[]) => toast.error(...a) },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/entities/user/queries', () => ({
  useCurrentUser: () => user(),
  useAddresses: () => addresses(),
  useLoyalty: () => loyalty(),
  useReferrals: () => referrals(),
  useDeleteAddress: () => deleteAddress,
  // The privacy card lives on this page too; it has its own spec.
  useSessions: () => ({ data: [], isLoading: false }),
  useRevokeSession: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/entities/product/queries', () => ({
  useFavorites: () => favorites(),
  useToggleFavorite: () => toggleFavorite,
}));
vi.mock('@/features/pizza-constructor/ui/pizza-constructor-dialog', () => ({
  PizzaConstructorDialog: () => null,
}));

beforeEach(() => {
  vi.clearAllMocks();
  user.mockReturnValue({ data: USER, isLoading: false });
  addresses.mockReturnValue({ data: [ADDRESS] });
  loyalty.mockReturnValue({ data: LOYALTY });
  referrals.mockReturnValue({ data: REFERRALS });
  favorites.mockReturnValue({ data: [] });
});

describe('ProfilePage — gates', () => {
  it('shows skeletons while the session loads', () => {
    user.mockReturnValue({ data: null, isLoading: true });
    const { container } = renderWithProviders(<ProfilePage />);

    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('asks a guest to sign in', () => {
    user.mockReturnValue({ data: null, isLoading: false });
    renderWithProviders(<ProfilePage />);

    expect(screen.getByRole('link', { name: 'Войдите, чтобы продолжить' })).toHaveAttribute(
      'href',
      '/login?redirect=/profile',
    );
  });
});

describe('ProfilePage — personal data', () => {
  it('shows the account details', () => {
    renderWithProviders(<ProfilePage />);

    expect(screen.getByText(/Амина/)).toBeInTheDocument();
    expect(screen.getByText('guest@chicago.ru')).toBeInTheDocument();
    expect(screen.getByText('+79280000000')).toBeInTheDocument();
  });

  it('flags an unverified email', () => {
    user.mockReturnValue({ data: { ...USER, isEmailVerified: false }, isLoading: false });
    renderWithProviders(<ProfilePage />);

    expect(screen.getByText('Email не подтверждён')).toBeInTheDocument();
  });
});

describe('ProfilePage — loyalty and referrals', () => {
  it('shows the balance, level and cashback rate', () => {
    renderWithProviders(<ProfilePage />);

    expect(screen.getByText('420')).toBeInTheDocument();
    expect(screen.getByText('SILVER')).toBeInTheDocument();
    expect(screen.getByText('Кэшбэк 7%')).toBeInTheDocument();
  });

  it('says how far the next level is', () => {
    renderWithProviders(<ProfilePage />);

    expect(screen.getByText(/До уровня GOLD/)).toBeInTheDocument();
  });

  it('falls back to the bronze rate before loyalty has loaded', () => {
    loyalty.mockReturnValue({ data: undefined });
    renderWithProviders(<ProfilePage />);

    expect(screen.getByText('Кэшбэк 5%')).toBeInTheDocument();
  });

  it('copies the referral code to the clipboard', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    renderWithProviders(<ProfilePage />);

    fireEvent.click(screen.getByRole('button', { name: /Ваш промокод для друзей/ }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('AABBCCDD'));
    expect(toast.success).toHaveBeenCalledWith('Скопировано');
  });

  it('reports invitations and rewards', () => {
    renderWithProviders(<ProfilePage />);

    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });
});

describe('ProfilePage — addresses and favorites', () => {
  it('lists saved addresses and deletes one', () => {
    renderWithProviders(<ProfilePage />);

    expect(screen.getByText(/Ленина/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    expect(deleteAddress.mutate).toHaveBeenCalledWith('addr-1');
  });

  it('says when there are no addresses', () => {
    addresses.mockReturnValue({ data: [] });
    renderWithProviders(<ProfilePage />);

    expect(screen.getByText('Адресов пока нет')).toBeInTheDocument();
  });

  it('says when there are no favorites', () => {
    renderWithProviders(<ProfilePage />);

    expect(screen.getByText('В избранном пусто')).toBeInTheDocument();
  });

  it('lists favorites and lets one be unfavourited', () => {
    favorites.mockReturnValue({
      data: [
        {
          id: 'p1',
          name: 'Пепперони',
          type: 'PIZZA',
          priceFrom: 44000,
          sizes: [],
          ingredients: [],
          description: null,
          imageUrl: null,
          isNew: false,
          isSpicy: false,
          isVegetarian: false,
          category: null,
        },
      ],
    });
    renderWithProviders(<ProfilePage />);

    expect(screen.getByRole('heading', { name: 'Пепперони' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Пепперони' }));
    expect(toggleFavorite.mutate).toHaveBeenCalledWith({ productId: 'p1', isFavorite: true });
  });
});
