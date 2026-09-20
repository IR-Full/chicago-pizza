import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { renderWithProviders } from '@/test/utils';
import { ApiError } from '@/shared/api/api-client';
import { PrivacySection } from './privacy-section';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const revokeSession = { mutate: vi.fn(), isPending: false };
const sessions = vi.fn();
vi.mock('@/entities/user/queries', () => ({
  useSessions: () => sessions(),
  useRevokeSession: () => revokeSession,
}));

const exportData = vi.fn();
const deleteAccount = vi.fn();
vi.mock('@/entities/user/api', () => ({
  userApi: {
    exportData: (...args: unknown[]) => exportData(...args),
    deleteAccount: (...args: unknown[]) => deleteAccount(...args),
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const SESSIONS = [
  {
    id: 'session-1',
    ip: '10.0.0.1',
    userAgent: 'Mozilla/5.0 (iPhone)',
    createdAt: '2026-09-19T10:00:00.000Z',
    expiresAt: '2026-10-19T10:00:00.000Z',
    isCurrent: true,
  },
  {
    id: 'session-2',
    ip: '203.0.113.7',
    userAgent: 'Mozilla/5.0 (Windows)',
    createdAt: '2026-09-18T08:00:00.000Z',
    expiresAt: '2026-10-18T08:00:00.000Z',
    isCurrent: false,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  sessions.mockReturnValue({ data: SESSIONS, isLoading: false });
  exportData.mockResolvedValue({ profile: { email: 'guest@chicago.ru' } });
  deleteAccount.mockResolvedValue({ success: true });
  // jsdom has neither of these; the download path uses both.
  URL.createObjectURL = vi.fn(() => 'blob:fake');
  URL.revokeObjectURL = vi.fn();
});

/**
 * `ip` and `userAgent` were recorded on every sign-in and shown to nobody.
 * This is the screen that makes collecting them defensible.
 */
describe('PrivacySection — sessions', () => {
  it('shows where each session signed in from', () => {
    renderWithProviders(<PrivacySection />);

    expect(screen.getByText('10.0.0.1')).toBeInTheDocument();
    expect(screen.getByText(/Mozilla\/5.0 \(Windows\)/)).toBeInTheDocument();
  });

  it('marks the session you are reading this from', () => {
    renderWithProviders(<PrivacySection />);

    expect(screen.getByText('Текущая')).toBeInTheDocument();
  });

  it('offers to end other sessions but not the current one', () => {
    renderWithProviders(<PrivacySection />);

    // One button for the other device; none for this one — signing yourself
    // out is what the logout control is for.
    const endButtons = screen.getAllByRole('button', { name: 'Завершить сессию' });
    expect(endButtons).toHaveLength(1);

    fireEvent.click(endButtons[0]);
    expect(revokeSession.mutate).toHaveBeenCalledWith('session-2');
  });
});

describe('PrivacySection — export', () => {
  it('downloads the data as a file rather than rendering it', async () => {
    renderWithProviders(<PrivacySection />);

    fireEvent.click(screen.getByRole('button', { name: /Скачать мои данные/ }));

    await waitFor(() => expect(exportData).toHaveBeenCalled());
    expect(URL.createObjectURL).toHaveBeenCalled();
    // The blob URL is released again; leaking it pins the copy in memory.
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake'));
  });

  it('reports a failed export instead of silently doing nothing', async () => {
    exportData.mockRejectedValue(new ApiError('Слишком много запросов', 429));
    renderWithProviders(<PrivacySection />);

    fireEvent.click(screen.getByRole('button', { name: /Скачать мои данные/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Слишком много запросов'));
  });
});

describe('PrivacySection — erasure', () => {
  it('asks before erasing, and says what survives', async () => {
    renderWithProviders(<PrivacySection />);

    fireEvent.click(screen.getByRole('button', { name: 'Удалить аккаунт' }));

    // "Delete everything" would be a lie — orders are accounting records.
    expect(await screen.findByText(/Заказы сохранятся обезличенными/)).toBeInTheDocument();
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it('erases the account and sends the visitor home', async () => {
    renderWithProviders(<PrivacySection />);

    fireEvent.click(screen.getByRole('button', { name: 'Удалить аккаунт' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Да, удалить' }));

    await waitFor(() => expect(deleteAccount).toHaveBeenCalled());
    expect(push).toHaveBeenCalledWith('/');
  });

  it('keeps the visitor where they are when erasure is refused', async () => {
    deleteAccount.mockRejectedValue(new ApiError('Нельзя удалить последнего администратора', 403));
    renderWithProviders(<PrivacySection />);

    fireEvent.click(screen.getByRole('button', { name: 'Удалить аккаунт' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Да, удалить' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Нельзя удалить последнего администратора'),
    );
    expect(push).not.toHaveBeenCalled();
  });

  it('backs out without touching the account', async () => {
    renderWithProviders(<PrivacySection />);

    fireEvent.click(screen.getByRole('button', { name: 'Удалить аккаунт' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Отмена' }));

    expect(deleteAccount).not.toHaveBeenCalled();
  });
});
