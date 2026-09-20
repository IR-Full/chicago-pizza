import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/utils';
import { ApiError } from '@/shared/api/api-client';
import LoginPage from './login/page';
import RegisterPage from './register/page';
import VerifyEmailPage from './verify-email/page';
import MenuPage from './menu/page';
import ForgotPasswordPage from './forgot-password/page';
import ResetPasswordPage from './reset-password/page';

const router = { push: vi.fn(), refresh: vi.fn() };
const searchParams = new Map<string, string>();
const redirect = vi.fn();
const toast = { success: vi.fn(), error: vi.fn() };

const forgot = { mutateAsync: vi.fn(), isPending: false };
const reset = { mutateAsync: vi.fn(), isPending: false };

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useSearchParams: () => ({ get: (key: string) => searchParams.get(key) ?? null }),
  usePathname: () => '/',
  redirect: (path: string) => redirect(path),
}));

vi.mock('sonner', () => ({
  toast: { success: (...a: unknown[]) => toast.success(...a), error: (...a: unknown[]) => toast.error(...a) },
}));

vi.mock('@/features/auth/model/use-auth', () => ({
  useLogin: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRegister: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useVerifyEmail: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useResendVerification: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useForgotPassword: () => forgot,
  useResetPassword: () => reset,
}));

// The catalog has its own spec; the menu page only needs to pass the category on.
vi.mock('@/widgets/catalog/catalog-view', () => ({
  CatalogView: ({ initialCategory }: { initialCategory?: string }) => (
    <div data-testid="catalog">{initialCategory ?? 'all'}</div>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  searchParams.clear();
  forgot.mutateAsync.mockResolvedValue({ sent: true });
  reset.mutateAsync.mockResolvedValue({ success: true });
});

describe('LoginPage', () => {
  it('renders the sign-in form', () => {
    renderWithProviders(<LoginPage />);

    expect(screen.getByRole('heading', { name: 'Вход' })).toBeInTheDocument();
  });
});

describe('RegisterPage', () => {
  it('renders the registration form', async () => {
    renderWithProviders(await RegisterPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole('heading', { name: 'Регистрация' })).toBeInTheDocument();
  });

  it('carries a referral code from the invite link into the form', async () => {
    renderWithProviders(await RegisterPage({ searchParams: Promise.resolve({ ref: 'FRIEND01' }) }));

    expect(screen.getByLabelText(/Реферальный код/)).toHaveValue('FRIEND01');
  });
});

describe('VerifyEmailPage', () => {
  it('shows the form for the address in the link', async () => {
    renderWithProviders(await VerifyEmailPage({ searchParams: Promise.resolve({ email: 'guest@chicago.ru' }) }));

    expect(screen.getByText(/guest@chicago.ru/)).toBeInTheDocument();
  });

  it('sends a visitor without an address back to registration', async () => {
    renderWithProviders(await VerifyEmailPage({ searchParams: Promise.resolve({}) }));

    expect(redirect).toHaveBeenCalledWith('/register');
  });
});

describe('MenuPage', () => {
  it('opens the whole catalog by default', async () => {
    renderWithProviders(await MenuPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByTestId('catalog')).toHaveTextContent('all');
  });

  it('preselects the category from the query string', async () => {
    renderWithProviders(await MenuPage({ searchParams: Promise.resolve({ category: 'drinks' }) }));

    expect(screen.getByTestId('catalog')).toHaveTextContent('drinks');
  });
});

describe('ForgotPasswordPage', () => {
  it('sends the reset request', async () => {
    renderWithProviders(<ForgotPasswordPage />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'guest@chicago.ru' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить ссылку' }));

    await waitFor(() => expect(forgot.mutateAsync).toHaveBeenCalledWith('guest@chicago.ru'));
  });

  it('answers the same way whether or not the account exists', async () => {
    renderWithProviders(<ForgotPasswordPage />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ghost@chicago.ru' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить ссылку' }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Если такой email зарегистрирован, мы отправили письмо'),
    );
  });

  it('validates the address before sending', async () => {
    renderWithProviders(<ForgotPasswordPage />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'не-почта' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить ссылку' }));

    await waitFor(() => expect(screen.getByText('Некорректный email')).toBeInTheDocument());
    expect(forgot.mutateAsync).not.toHaveBeenCalled();
  });
});

describe('ResetPasswordPage', () => {
  it('refuses to render a form without a token', () => {
    renderWithProviders(<ResetPasswordPage />);

    expect(screen.getByText('Ссылка восстановления недействительна')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Восстановить пароль' })).not.toBeInTheDocument();
  });

  it('sets the new password and sends the visitor to sign in', async () => {
    searchParams.set('token', 'tok');
    renderWithProviders(<ResetPasswordPage />);

    fireEvent.change(screen.getByLabelText('Новый пароль'), { target: { value: 'NewPass1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Восстановить пароль' }));

    await waitFor(() => expect(reset.mutateAsync).toHaveBeenCalledWith({ token: 'tok', newPassword: 'NewPass1' }));
    expect(router.push).toHaveBeenCalledWith('/login');
  });

  it('applies the password policy before calling the API', async () => {
    searchParams.set('token', 'tok');
    renderWithProviders(<ResetPasswordPage />);

    fireEvent.change(screen.getByLabelText('Новый пароль'), { target: { value: 'weak' } });
    fireEvent.click(screen.getByRole('button', { name: 'Восстановить пароль' }));

    await waitFor(() => expect(screen.getByText('Минимум 8 символов')).toBeInTheDocument());
    expect(reset.mutateAsync).not.toHaveBeenCalled();
  });

  it('reports an expired link', async () => {
    searchParams.set('token', 'old');
    reset.mutateAsync.mockRejectedValue(new ApiError('Invalid or expired reset token', 400));
    renderWithProviders(<ResetPasswordPage />);

    fireEvent.change(screen.getByLabelText('Новый пароль'), { target: { value: 'NewPass1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Восстановить пароль' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Invalid or expired reset token'));
  });
});
