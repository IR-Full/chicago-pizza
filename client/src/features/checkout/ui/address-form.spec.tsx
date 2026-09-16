import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/utils';
import { ApiError } from '@/shared/api/api-client';
import { AddressForm } from './address-form';

const createAddress = { mutateAsync: vi.fn(), isPending: false };
const toast = { error: vi.fn(), success: vi.fn() };

vi.mock('sonner', () => ({
  toast: { error: (...a: unknown[]) => toast.error(...a), success: (...a: unknown[]) => toast.success(...a) },
}));
vi.mock('@/entities/user/queries', () => ({ useCreateAddress: () => createAddress }));

beforeEach(() => {
  vi.clearAllMocks();
  createAddress.mutateAsync.mockResolvedValue({ id: 'addr-1' });
});

const fill = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

const fillRequired = () => {
  fill(/Название/, 'Дом');
  fill('Улица', 'пр. Расула Гамзатова');
  fill('Дом', '45');
};

describe('AddressForm', () => {
  it('saves a new address and reports its id back', async () => {
    const onCreated = vi.fn();
    renderWithProviders(<AddressForm onCreated={onCreated} />);

    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(createAddress.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Дом',
          city: 'Махачкала',
          street: 'пр. Расула Гамзатова',
          house: '45',
        }),
      ),
    );
    expect(onCreated).toHaveBeenCalledWith('addr-1');
  });

  it('sends null rather than empty strings for the optional parts', async () => {
    renderWithProviders(<AddressForm onCreated={vi.fn()} />);

    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(createAddress.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ apartment: null, entrance: null, floor: null, comment: null }),
      ),
    );
  });

  it('keeps the optional parts that were filled in', async () => {
    renderWithProviders(<AddressForm onCreated={vi.fn()} />);

    fillRequired();
    fill(/Квартира/, '12');
    fill(/Подъезд/, '2');
    fill(/Этаж/, '4');
    fill(/Комментарий/, 'код домофона 45');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(createAddress.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ apartment: '12', entrance: '2', floor: '4', comment: 'код домофона 45' }),
      ),
    );
  });

  it('never invents coordinates for a hand-typed address', async () => {
    renderWithProviders(<AddressForm onCreated={vi.fn()} />);

    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(createAddress.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ lat: null, lng: null, isDefault: false }),
      ),
    );
  });

  it('blocks a submit that is missing the street', async () => {
    renderWithProviders(<AddressForm onCreated={vi.fn()} />);

    fill(/Название/, 'Дом');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(screen.getAllByText('Обязательное поле').length).toBeGreaterThan(0));
    expect(createAddress.mutateAsync).not.toHaveBeenCalled();
  });

  it('reports a server failure without losing what was typed', async () => {
    createAddress.mutateAsync.mockRejectedValue(new ApiError('Адрес вне зоны доставки', 400));
    const onCreated = vi.fn();
    renderWithProviders(<AddressForm onCreated={onCreated} />);

    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Адрес вне зоны доставки'));
    expect(onCreated).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Улица')).toHaveValue('пр. Расула Гамзатова');
  });

  it('clears the form after a successful save', async () => {
    renderWithProviders(<AddressForm onCreated={vi.fn()} />);

    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(screen.getByLabelText('Улица')).toHaveValue(''));
  });
});
