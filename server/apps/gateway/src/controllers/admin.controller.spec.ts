import { ClientProxy } from '@nestjs/microservices';
import { of } from 'rxjs';
import {
  AUTH_PATTERNS,
  ORDERS_PATTERNS,
  PRODUCTS_PATTERNS,
  ROLES_KEY,
  SUPPORT_PATTERNS,
} from '@chicago-pizza/common';
import { AdminController } from './admin.controller';
import { RealtimeGateway } from '../realtime/realtime.gateway';

function createController(reply: unknown = { ok: true }) {
  const proxies = {
    auth: jest.fn(() => of(reply)),
    products: jest.fn(() => of(reply)),
    orders: jest.fn(() => of(reply)),
    support: jest.fn(() => of(reply)),
  };
  const realtime = { emitOrderStatus: jest.fn() } as unknown as RealtimeGateway;

  const controller = new AdminController(
    { send: proxies.auth } as unknown as ClientProxy,
    { send: proxies.products } as unknown as ClientProxy,
    { send: proxies.orders } as unknown as ClientProxy,
    { send: proxies.support } as unknown as ClientProxy,
    realtime,
  );

  return { controller, ...proxies, realtime };
}

const meta = (key: string, method: keyof AdminController) =>
  Reflect.getMetadata(key, AdminController.prototype[method]);

describe('gateway AdminController — access control', () => {
  it('is mounted under /admin', () => {
    expect(Reflect.getMetadata('path', AdminController)).toBe('admin');
  });

  it.each([
    ['listOrders', ['ADMIN', 'COURIER']],
    ['updateOrderStatus', ['ADMIN', 'COURIER']],
    ['listTickets', ['ADMIN', 'SUPPORT']],
  ])('%s is limited to %s', (method, roles) => {
    expect(meta(ROLES_KEY, method as keyof AdminController)).toEqual(roles);
  });

  it.each([
    ['createCategory'],
    ['createProduct'],
    ['updateProduct'],
    ['deleteProduct'],
    ['listPromocodes'],
    ['createPromocode'],
    ['listUsers'],
    ['setUserRole'],
    ['setUserBlocked'],
  ])('%s is admin-only', (method) => {
    // A courier must not be able to reprice the menu or unblock an account.
    expect(meta(ROLES_KEY, method as keyof AdminController)).toEqual(['ADMIN']);
  });

  it('leaves no admin route without a role requirement', () => {
    const methods = Object.getOwnPropertyNames(AdminController.prototype).filter(
      (name) => name !== 'constructor',
    ) as (keyof AdminController)[];

    for (const method of methods) {
      expect(meta(ROLES_KEY, method)).toBeDefined();
    }
  });
});

describe('gateway AdminController — orders', () => {
  it('converts the pagination query and passes the status filter', async () => {
    const { controller, orders } = createController({ items: [] });

    await controller.listOrders('2', '10', 'PREPARING' as never);

    expect(orders).toHaveBeenCalledWith(ORDERS_PATTERNS.ADMIN_LIST_ORDERS, {
      page: 2,
      limit: 10,
      status: 'PREPARING',
    });
  });

  it('defaults to the first page of twenty', async () => {
    const { controller, orders } = createController({ items: [] });

    await controller.listOrders();

    expect(orders).toHaveBeenCalledWith(ORDERS_PATTERNS.ADMIN_LIST_ORDERS, {
      page: 1,
      limit: 20,
      status: undefined,
    });
  });

  it('records who changed the status and pushes it to the customer', async () => {
    const { controller, orders, realtime } = createController({
      id: 'order-1',
      userId: 'user-9',
      status: 'ON_DELIVERY',
      updatedAt: '2026-09-16T10:00:00.000Z',
    });

    const result = await controller.updateOrderStatus({ sub: 'courier-1' } as never, 'order-1', {
      status: 'ON_DELIVERY',
    } as never);

    expect(orders).toHaveBeenCalledWith(ORDERS_PATTERNS.ADMIN_UPDATE_STATUS, {
      orderId: 'order-1',
      status: 'ON_DELIVERY',
      changedById: 'courier-1',
    });
    expect(realtime.emitOrderStatus).toHaveBeenCalledWith('user-9', {
      orderId: 'order-1',
      status: 'ON_DELIVERY',
      updatedAt: '2026-09-16T10:00:00.000Z',
    });
    expect(result).toMatchObject({ id: 'order-1' });
  });
});

describe('gateway AdminController — catalog', () => {
  it('forwards the category and product bodies verbatim', async () => {
    const { controller, products } = createController({ id: 'p1' });

    await controller.createCategory({ name: 'Комбо', slug: 'combo' });
    await controller.createProduct({ name: 'Ойси', slug: 'oisi' } as never);

    expect(products).toHaveBeenNthCalledWith(1, PRODUCTS_PATTERNS.ADMIN_CREATE_CATEGORY, {
      name: 'Комбо',
      slug: 'combo',
    });
    expect(products).toHaveBeenNthCalledWith(2, PRODUCTS_PATTERNS.ADMIN_CREATE_PRODUCT, {
      name: 'Ойси',
      slug: 'oisi',
    });
  });

  it('splits id and patch when updating, and delists on delete', async () => {
    const { controller, products } = createController({ id: 'p1' });

    await controller.updateProduct('p1', { isPopular: true } as never);
    await controller.deleteProduct('p1');

    expect(products).toHaveBeenNthCalledWith(1, PRODUCTS_PATTERNS.ADMIN_UPDATE_PRODUCT, {
      productId: 'p1',
      data: { isPopular: true },
    });
    expect(products).toHaveBeenNthCalledWith(2, PRODUCTS_PATTERNS.ADMIN_DELETE_PRODUCT, { productId: 'p1' });
  });
});

describe('gateway AdminController — promocodes and users', () => {
  it('lists and creates promocodes', async () => {
    const { controller, orders } = createController([]);

    await controller.listPromocodes();
    await controller.createPromocode({ code: 'CHICAGO10', discountType: 'PERCENT', discountValue: 10 } as never);

    expect(orders).toHaveBeenNthCalledWith(1, ORDERS_PATTERNS.ADMIN_LIST_PROMOCODES, {});
    expect(orders).toHaveBeenNthCalledWith(2, ORDERS_PATTERNS.ADMIN_CREATE_PROMOCODE, {
      code: 'CHICAGO10',
      discountType: 'PERCENT',
      discountValue: 10,
    });
  });

  it('passes the user search through', async () => {
    const { controller, auth } = createController({ items: [] });

    await controller.listUsers('1', '20', 'амина');

    expect(auth).toHaveBeenCalledWith(AUTH_PATTERNS.ADMIN_LIST_USERS, { page: 1, limit: 20, search: 'амина' });
  });

  it('defaults the user list to the first page of twenty', async () => {
    const { controller, auth } = createController({ items: [] });

    await controller.listUsers();

    expect(auth).toHaveBeenCalledWith(AUTH_PATTERNS.ADMIN_LIST_USERS, {
      page: 1,
      limit: 20,
      search: undefined,
    });
  });

  it('sets a role and a block flag', async () => {
    const { controller, auth } = createController({ id: 'user-1' });

    await controller.setUserRole('user-1', { role: 'COURIER' as never });
    await controller.setUserBlocked('user-1', { isBlocked: true });

    expect(auth).toHaveBeenNthCalledWith(1, AUTH_PATTERNS.ADMIN_SET_ROLE, { userId: 'user-1', role: 'COURIER' });
    expect(auth).toHaveBeenNthCalledWith(2, AUTH_PATTERNS.ADMIN_SET_BLOCKED, { userId: 'user-1', isBlocked: true });
  });
});

describe('gateway AdminController — support inbox', () => {
  it('defaults the inbox to the first page of twenty', async () => {
    const { controller, support } = createController({ items: [] });

    await controller.listTickets();

    expect(support).toHaveBeenCalledWith(SUPPORT_PATTERNS.ADMIN_LIST_TICKETS, {
      page: 1,
      limit: 20,
      status: undefined,
    });
  });

  it('forwards pagination and the status filter', async () => {
    const { controller, support } = createController({ items: [] });

    await controller.listTickets('3', '5', 'OPEN' as never);

    expect(support).toHaveBeenCalledWith(SUPPORT_PATTERNS.ADMIN_LIST_TICKETS, {
      page: 3,
      limit: 5,
      status: 'OPEN',
    });
  });
});
