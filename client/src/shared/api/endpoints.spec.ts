import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api-client';
import { cartApi } from '@/entities/cart/api';
import { orderApi } from '@/entities/order/api';
import { productApi } from '@/entities/product/api';
import { supportApi } from '@/entities/support/api';
import { userApi } from '@/entities/user/api';
import { authApi } from '@/features/auth/api';
import { adminApi } from '@/features/admin/api';

/**
 * One place that pins every REST path, verb and body the client produces.
 * These strings are a contract with the gateway: a typo compiles fine and
 * only fails against a running stack, so it is asserted here instead.
 */
vi.mock('./api-client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

beforeEach(() => vi.clearAllMocks());

describe('catalog endpoints', () => {
  it('reads the reference lists', () => {
    productApi.categories();
    productApi.doughTypes();
    productApi.ingredients();
    productApi.recommendations();

    expect(api.get).toHaveBeenNthCalledWith(1, '/categories');
    expect(api.get).toHaveBeenNthCalledWith(2, '/dough-types');
    expect(api.get).toHaveBeenNthCalledWith(3, '/ingredients');
    expect(api.get).toHaveBeenNthCalledWith(4, '/recommendations');
  });

  it('passes every catalog filter as a query parameter', () => {
    productApi.list({ categorySlug: 'pizza', search: 'сыр', isSpicy: true, page: 2, limit: 30 });

    expect(api.get).toHaveBeenCalledWith('/products', {
      query: expect.objectContaining({
        categorySlug: 'pizza',
        search: 'сыр',
        isSpicy: true,
        page: 2,
        limit: 30,
      }),
    });
  });

  it('defaults to no filters at all', () => {
    productApi.list();

    const { query } = vi.mocked(api.get).mock.calls[0][1] as { query: Record<string, unknown> };
    expect(Object.values(query).every((value) => value === undefined)).toBe(true);
  });

  it('reads one product by slug or id', () => {
    productApi.get('pepperoni');

    expect(api.get).toHaveBeenCalledWith('/products/pepperoni');
  });

  it('prices a configuration, defaulting to one', () => {
    productApi.price({ productId: 'p1' } as never);

    expect(api.post).toHaveBeenCalledWith('/products/price', { config: { productId: 'p1' }, quantity: 1 });
  });

  it('toggles favorites by product id', () => {
    productApi.favorites();
    productApi.addFavorite('p1');
    productApi.removeFavorite('p1');

    expect(api.get).toHaveBeenCalledWith('/favorites');
    expect(api.post).toHaveBeenCalledWith('/favorites/p1');
    expect(api.delete).toHaveBeenCalledWith('/favorites/p1');
  });
});

describe('cart endpoints', () => {
  it('maps each cart action to its route', () => {
    cartApi.get();
    cartApi.addItem({ productId: 'p1' } as never, 2);
    cartApi.updateItem('l1', 3);
    cartApi.removeItem('l1');
    cartApi.clear();
    cartApi.checkPromocode('CHICAGO10');

    expect(api.get).toHaveBeenCalledWith('/cart');
    expect(api.post).toHaveBeenCalledWith('/cart/items', { config: { productId: 'p1' }, quantity: 2 });
    expect(api.patch).toHaveBeenCalledWith('/cart/items/l1', { quantity: 3 });
    expect(api.delete).toHaveBeenNthCalledWith(1, '/cart/items/l1');
    expect(api.delete).toHaveBeenNthCalledWith(2, '/cart');
    expect(api.post).toHaveBeenCalledWith('/cart/promocode', { code: 'CHICAGO10' });
  });

  it('adds a single item by default', () => {
    cartApi.addItem({ productId: 'p1' } as never);

    expect(api.post).toHaveBeenCalledWith('/cart/items', { config: { productId: 'p1' }, quantity: 1 });
  });
});

describe('order endpoints', () => {
  it('maps each order action to its route', () => {
    orderApi.checkout({ addressId: 'addr-1' } as never);
    orderApi.list(2, 5);
    orderApi.get('order-1');
    orderApi.repeat('order-1');
    orderApi.review('order-1', 5, 'Вкусно');

    expect(api.post).toHaveBeenNthCalledWith(1, '/orders', { addressId: 'addr-1' });
    expect(api.get).toHaveBeenNthCalledWith(1, '/orders', { query: { page: 2, limit: 5 } });
    expect(api.get).toHaveBeenNthCalledWith(2, '/orders/order-1');
    expect(api.post).toHaveBeenNthCalledWith(2, '/orders/order-1/repeat');
    expect(api.post).toHaveBeenNthCalledWith(3, '/orders/order-1/review', { rating: 5, comment: 'Вкусно' });
  });

  it('defaults the history to the first page of twenty', () => {
    orderApi.list();

    expect(api.get).toHaveBeenCalledWith('/orders', { query: { page: 1, limit: 20 } });
  });

  it('allows a review without a comment', () => {
    orderApi.review('order-1', 4);

    expect(api.post).toHaveBeenCalledWith('/orders/order-1/review', { rating: 4, comment: undefined });
  });
});

describe('profile endpoints', () => {
  it('maps profile and address actions', () => {
    userApi.me();
    userApi.updateProfile({ firstName: 'Амина' });
    userApi.listAddresses();
    userApi.createAddress({ title: 'Дом' } as never);
    userApi.updateAddress('addr-1', { house: '7' });
    userApi.deleteAddress('addr-1');
    userApi.loyalty();
    userApi.referrals();

    expect(api.get).toHaveBeenNthCalledWith(1, '/auth/me');
    expect(api.patch).toHaveBeenNthCalledWith(1, '/auth/me', { firstName: 'Амина' });
    expect(api.get).toHaveBeenNthCalledWith(2, '/auth/addresses');
    expect(api.post).toHaveBeenCalledWith('/auth/addresses', { title: 'Дом' });
    expect(api.patch).toHaveBeenNthCalledWith(2, '/auth/addresses/addr-1', { house: '7' });
    expect(api.delete).toHaveBeenCalledWith('/auth/addresses/addr-1');
    expect(api.get).toHaveBeenNthCalledWith(3, '/loyalty');
    expect(api.get).toHaveBeenNthCalledWith(4, '/referrals');
  });
});

describe('auth endpoints', () => {
  it('maps every step of the account lifecycle', () => {
    authApi.register({ email: 'a@b.ru', password: 'Password1', firstName: 'Амина' });
    authApi.login('a@b.ru', 'Password1');
    authApi.logout();
    authApi.verifyEmail('a@b.ru', '123456');
    authApi.resendVerification('a@b.ru');
    authApi.forgotPassword('a@b.ru');
    authApi.resetPassword('token', 'NewPass1');

    expect(api.post).toHaveBeenNthCalledWith(1, '/auth/register', {
      email: 'a@b.ru',
      password: 'Password1',
      firstName: 'Амина',
    });
    expect(api.post).toHaveBeenNthCalledWith(2, '/auth/login', { email: 'a@b.ru', password: 'Password1' });
    expect(api.post).toHaveBeenNthCalledWith(3, '/auth/logout');
    expect(api.post).toHaveBeenNthCalledWith(4, '/auth/verify-email', { email: 'a@b.ru', code: '123456' });
    expect(api.post).toHaveBeenNthCalledWith(5, '/auth/resend-verification', { email: 'a@b.ru' });
    expect(api.post).toHaveBeenNthCalledWith(6, '/auth/forgot-password', { email: 'a@b.ru' });
    expect(api.post).toHaveBeenNthCalledWith(7, '/auth/reset-password', { token: 'token', newPassword: 'NewPass1' });
  });

  it('never sends a password anywhere but the auth routes', () => {
    authApi.login('a@b.ru', 'Password1');

    const [path] = vi.mocked(api.post).mock.calls[0];
    expect(path.startsWith('/auth/')).toBe(true);
  });
});

describe('support endpoints', () => {
  it('maps tickets and notifications', () => {
    supportApi.createTicket('Тема', 'Текст');
    supportApi.listTickets();
    supportApi.getTicket('t1');
    supportApi.addMessage('t1', 'Привет');
    supportApi.closeTicket('t1');
    supportApi.notifications(2);
    supportApi.markRead('n1');

    expect(api.post).toHaveBeenNthCalledWith(1, '/support/tickets', {
      subject: 'Тема',
      message: 'Текст',
      channel: 'TICKET',
    });
    expect(api.get).toHaveBeenNthCalledWith(1, '/support/tickets');
    expect(api.get).toHaveBeenNthCalledWith(2, '/support/tickets/t1');
    expect(api.post).toHaveBeenNthCalledWith(2, '/support/tickets/t1/messages', { message: 'Привет' });
    expect(api.patch).toHaveBeenNthCalledWith(1, '/support/tickets/t1/close');
    expect(api.get).toHaveBeenNthCalledWith(3, '/notifications', { query: { page: 2 } });
    expect(api.patch).toHaveBeenNthCalledWith(2, '/notifications/read', undefined, { query: { id: 'n1' } });
  });

  it('opens a chat ticket when asked', () => {
    supportApi.createTicket('Онлайн-чат', 'Здравствуйте', 'CHAT');

    expect(api.post).toHaveBeenCalledWith('/support/tickets', {
      subject: 'Онлайн-чат',
      message: 'Здравствуйте',
      channel: 'CHAT',
    });
  });

  it('marks everything read when no id is given', () => {
    supportApi.markRead();

    expect(api.patch).toHaveBeenCalledWith('/notifications/read', undefined, { query: { id: undefined } });
  });
});

describe('admin endpoints', () => {
  it('maps every staff action', () => {
    adminApi.listOrders(2, 'PREPARING' as never);
    adminApi.updateOrderStatus('order-1', 'DELIVERED' as never);
    adminApi.listPromocodes();
    adminApi.createPromocode({ code: 'X', discountType: 'PERCENT' as never, discountValue: 10 });
    adminApi.listUsers(1, 'амина');
    adminApi.setUserRole('user-1', 'COURIER' as never);
    adminApi.setUserBlocked('user-1', true);
    adminApi.listTickets(1, 'OPEN' as never);
    adminApi.deleteProduct('p1');

    expect(api.get).toHaveBeenNthCalledWith(1, '/admin/orders', { query: { page: 2, status: 'PREPARING' } });
    expect(api.patch).toHaveBeenNthCalledWith(1, '/admin/orders/order-1/status', { status: 'DELIVERED' });
    expect(api.get).toHaveBeenNthCalledWith(2, '/admin/promocodes');
    expect(api.post).toHaveBeenCalledWith('/admin/promocodes', {
      code: 'X',
      discountType: 'PERCENT',
      discountValue: 10,
    });
    expect(api.get).toHaveBeenNthCalledWith(3, '/admin/users', { query: { page: 1, search: 'амина' } });
    expect(api.patch).toHaveBeenNthCalledWith(2, '/admin/users/user-1/role', { role: 'COURIER' });
    expect(api.patch).toHaveBeenNthCalledWith(3, '/admin/users/user-1/blocked', { isBlocked: true });
    expect(api.get).toHaveBeenNthCalledWith(4, '/admin/tickets', { query: { page: 1, status: 'OPEN' } });
    expect(api.delete).toHaveBeenCalledWith('/admin/products/p1');
  });

  it('defaults the staff lists to the first page with no filter', () => {
    adminApi.listOrders();
    adminApi.listUsers();
    adminApi.listTickets();

    expect(api.get).toHaveBeenNthCalledWith(1, '/admin/orders', { query: { page: 1, status: undefined } });
    expect(api.get).toHaveBeenNthCalledWith(2, '/admin/users', { query: { page: 1, search: undefined } });
    expect(api.get).toHaveBeenNthCalledWith(3, '/admin/tickets', { query: { page: 1, status: undefined } });
  });

  it('keeps every staff route under /admin, which the gateway guards by role', () => {
    adminApi.listOrders();
    adminApi.listUsers();
    adminApi.deleteProduct('p1');

    const paths = [
      ...vi.mocked(api.get).mock.calls.map(([path]) => path),
      ...vi.mocked(api.delete).mock.calls.map(([path]) => path),
    ];
    expect(paths.every((path) => path.startsWith('/admin/'))).toBe(true);
  });
});
