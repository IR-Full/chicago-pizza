import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/utils';
import { ApiError } from '@/shared/api/api-client';
import { LoginForm } from './login-form';
import { RegisterForm } from './register-form';
import { VerifyEmailForm } from './verify-email-form';

const router = { push: vi.fn(), refresh: vi.fn() };
const searchParams = new Map<string, string>();
const toast = { success: vi.fn(), error: vi.fn() };

const login = { mutateAsync: vi.fn(), isPending: false };
const registerMutation = { mutateAsync: vi.fn(), isPending: false };
const verify = { mutateAsync: vi.fn(), isPending: false };
const resend = { mutateAsync: vi.fn(), isPending: false };

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useSearchParams: () => ({ get: (key: string) => searchParams.get(key) ?? null }),
}));

vi.mock('sonner', () => ({ toast: { success: (...a: unknown[]) => toast.success(...a), error: (...a: unknown[]) => toast.error(...a) } }));

vi.mock('../model/use-auth', () => ({
  useLogin: () => login,
  useRegister: () => registerMutation,
  useVerifyEmail: () => verify,
  useResendVerification: () => resend,
}));

beforeEach(() => {
  vi.clearAllMocks();
  searchParams.clear();
  login.mutateAsync.mockResolvedValue({ user: { id: 'user-1' } });
  registerMutation.mutateAsync.mockResolvedValue({ user: { id: 'user-1' } });
  verify.mutateAsync.mockResolvedValue({ verified: true });
  resend.mutateAsync.mockResolvedValue({ sent: true });
});

const type = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('LoginForm', () => {
  it('signs in and continues to the menu', async () => {
    renderWithProviders(<LoginForm />);

    type('Email', 'guest@chicago.ru');
    type('Пароль', 'Password1');
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    await waitFor(() =>
      expect(login.mutateAsync).toHaveBeenCalledWith({ email: 'guest@chicago.ru', password: 'Password1' }),
    );
    expect(router.push).toHaveBeenCalledWith('/menu');
  });

  it('returns the customer to where they were headed', async () => {
    searchParams.set('redirect', '/checkout');
    renderWithProviders(<LoginForm />);

    type('Email', 'guest@chicago.ru');
    type('Пароль', 'Password1');
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/checkout'));
  });

  it('shows field errors in Russian and does not call the API', async () => {
    renderWithProviders(<LoginForm />);

    type('Email', 'не-почта');
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    await waitFor(() => expect(screen.getByText('Некорректный email')).toBeInTheDocument());
    expect(screen.getByText('Обязательное поле')).toBeInTheDocument();
    expect(login.mutateAsync).not.toHaveBeenCalled();
  });

  it('surfaces the server message on bad credentials', async () => {
    login.mutateAsync.mockRejectedValue(new ApiError('Invalid email or password', 401));
    renderWithProviders(<LoginForm />);

    type('Email', 'guest@chicago.ru');
    type('Пароль', 'Password1');
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Invalid email or password'));
    expect(router.push).not.toHaveBeenCalled();
  });

  it('falls back to a generic message for an unexpected failure', async () => {
    login.mutateAsync.mockRejectedValue(new Error('offline'));
    renderWithProviders(<LoginForm />);

    type('Email', 'guest@chicago.ru');
    type('Пароль', 'Password1');
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Не удалось войти'));
  });

  it('links to registration and password recovery', () => {
    renderWithProviders(<LoginForm />);

    expect(screen.getByRole('link', { name: 'Зарегистрироваться' })).toHaveAttribute('href', '/register');
    expect(screen.getByRole('link', { name: 'Забыли пароль?' })).toHaveAttribute('href', '/forgot-password');
  });
});

describe('RegisterForm', () => {
  const fillValid = () => {
    type('Email', 'guest@chicago.ru');
    type(/^Пароль/, 'Password1');
    type('Имя', 'Амина');
    // The consent box is unticked by default and the form will not submit
    // without it — that is the point of it.
    fireEvent.click(screen.getByRole('checkbox'));
  };

  it('registers and sends the visitor to confirm their email', async () => {
    renderWithProviders(<RegisterForm />);

    fillValid();
    fireEvent.click(screen.getByRole('button', { name: 'Зарегистрироваться' }));

    await waitFor(() =>
      expect(registerMutation.mutateAsync).toHaveBeenCalledWith({
        email: 'guest@chicago.ru',
        password: 'Password1',
        firstName: 'Амина',
        lastName: undefined,
        phone: undefined,
        referralCode: undefined,
        acceptPrivacyPolicy: true,
      }),
    );
    expect(router.push).toHaveBeenCalledWith('/verify-email?email=guest%40chicago.ru');
  });

  it('sends the optional fields when they are filled', async () => {
    renderWithProviders(<RegisterForm />);

    fillValid();
    type('Фамилия', 'Магомедова');
    type('Телефон', '+79280000000');
    fireEvent.click(screen.getByRole('button', { name: 'Зарегистрироваться' }));

    await waitFor(() =>
      expect(registerMutation.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ lastName: 'Магомедова', phone: '+79280000000' }),
      ),
    );
  });

  it('carries a referral code in from the link', async () => {
    renderWithProviders(<RegisterForm initialReferralCode="FRIEND01" />);

    expect(screen.getByLabelText(/Реферальный код/)).toHaveValue('FRIEND01');

    fillValid();
    fireEvent.click(screen.getByRole('button', { name: 'Зарегистрироваться' }));

    await waitFor(() =>
      expect(registerMutation.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ referralCode: 'FRIEND01' }),
      ),
    );
  });

  it('explains a weak password without calling the API', async () => {
    renderWithProviders(<RegisterForm />);

    type('Email', 'guest@chicago.ru');
    type(/^Пароль/, 'password');
    type('Имя', 'Амина');
    fireEvent.click(screen.getByRole('button', { name: 'Зарегистрироваться' }));

    await waitFor(() =>
      expect(screen.getByText('Нужны заглавные, строчные буквы и цифра')).toBeInTheDocument(),
    );
    expect(registerMutation.mutateAsync).not.toHaveBeenCalled();
  });

  it('explains a malformed phone', async () => {
    renderWithProviders(<RegisterForm />);

    fillValid();
    type('Телефон', '89280000000');
    fireEvent.click(screen.getByRole('button', { name: 'Зарегистрироваться' }));

    await waitFor(() => expect(screen.getByText('Формат: +7XXXXXXXXXX')).toBeInTheDocument());
  });

  it('surfaces whatever the server refused with', async () => {
    // The API no longer distinguishes a taken address — this covers the
    // refusals it does still make, such as a phone that belongs to someone.
    registerMutation.mutateAsync.mockRejectedValue(new ApiError('Этот номер телефона уже используется', 409));
    renderWithProviders(<RegisterForm />);

    fillValid();
    fireEvent.click(screen.getByRole('button', { name: 'Зарегистрироваться' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Этот номер телефона уже используется'));
  });

  it('will not submit until the personal-data consent is given', async () => {
    renderWithProviders(<RegisterForm />);

    type('Email', 'guest@chicago.ru');
    type(/^Пароль/, 'Password1');
    type('Имя', 'Амина');
    fireEvent.click(screen.getByRole('button', { name: 'Зарегистрироваться' }));

    await waitFor(() =>
      expect(
        screen.getByText('Без согласия на обработку персональных данных регистрация невозможна'),
      ).toBeInTheDocument(),
    );
    expect(registerMutation.mutateAsync).not.toHaveBeenCalled();
  });
});

describe('VerifyEmailForm', () => {
  it('shows which address the code went to', () => {
    renderWithProviders(<VerifyEmailForm email="guest@chicago.ru" />);

    expect(screen.getByText(/guest@chicago.ru/)).toBeInTheDocument();
  });

  it('verifies the code and sends the visitor to sign in', async () => {
    renderWithProviders(<VerifyEmailForm email="guest@chicago.ru" />);

    type(/Код/, '123456');
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' }));

    await waitFor(() =>
      expect(verify.mutateAsync).toHaveBeenCalledWith({ email: 'guest@chicago.ru', code: '123456' }),
    );
    expect(toast.success).toHaveBeenCalledWith('Email подтверждён');
    expect(router.push).toHaveBeenCalledWith('/login');
  });

  it('rejects a code of the wrong length locally', async () => {
    renderWithProviders(<VerifyEmailForm email="guest@chicago.ru" />);

    type(/Код/, '123');
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' }));

    await waitFor(() => expect(screen.getByText('Код состоит из 6 цифр')).toBeInTheDocument());
    expect(verify.mutateAsync).not.toHaveBeenCalled();
  });

  it('reports an expired code from the server', async () => {
    verify.mutateAsync.mockRejectedValue(new ApiError('Invalid or expired verification code', 400));
    renderWithProviders(<VerifyEmailForm email="guest@chicago.ru" />);

    type(/Код/, '000000');
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Invalid or expired verification code'));
  });

  it('resends the code on request', async () => {
    renderWithProviders(<VerifyEmailForm email="guest@chicago.ru" />);

    fireEvent.click(screen.getByRole('button', { name: 'Отправить код ещё раз' }));

    await waitFor(() => expect(resend.mutateAsync).toHaveBeenCalledWith('guest@chicago.ru'));
    expect(toast.success).toHaveBeenCalled();
  });

  it('reports a throttled resend', async () => {
    resend.mutateAsync.mockRejectedValue(new ApiError('Too many requests, try again in a minute', 400));
    renderWithProviders(<VerifyEmailForm email="guest@chicago.ru" />);

    fireEvent.click(screen.getByRole('button', { name: 'Отправить код ещё раз' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Too many requests, try again in a minute'));
  });
});
