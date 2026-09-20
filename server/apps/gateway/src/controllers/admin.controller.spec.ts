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
import { AdminOrderQueryDto, AdminTicketQueryDto, AdminUserQueryDto } from '../dto/admin.dto';

/**
 * Builds a validated query object the way the ValidationPipe would, so the
 * tests exercise the same defaults (page 1, 20 per page) the HTTP layer applies.
 */
const query = <T extends object>(Dto: new () => T, overrides: Partial<T> = {}): T =>
  Object.assign(new Dto(), overrides);

/** Every staff-facing list is scoped by who is asking. */
const ACTOR = { sub: 'admin-1', email: 'admin@chicago.ru', role: 'ADMIN' } as never;
import { RealtimeGateway } from '../realtime/realtime.gateway';

function createController(reply: unknown = { ok: true }) {
  const proxies = {
    auth: jest.fn(() => of(reply)),
    products: jest.fn(() => of(reply)),
    orders: jest.fn(() => of(reply)),
    support: jest.fn(() => of(reply)),
  };
  const realtime = {
    emitOrderStatus: jest.fn(),
    emitNotification: jest.fn(),
  } as unknown as RealtimeGateway;

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

    await controller.listOrders(ACTOR, query(AdminOrderQueryDto, { page: 2, limit: 10, status: 'PREPARING' }));

    expect(orders).toHaveBeenCalledWith(ORDERS_PATTERNS.ADMIN_LIST_ORDERS, {
      page: 2,
      limit: 10,
      status: 'PREPARING',
      // The list is scoped to who is asking: a courier must not receive the
      // address and phone of every customer the shop has ever had.
      actorId: 'admin-1',
      actorRole: 'ADMIN',
    });
  });

  it('defaults to the first page of twenty', async () => {
    const { controller, orders } = createController({ items: [] });

    await controller.listOrders(ACTOR, query(AdminOrderQueryDto));

    expect(orders).toHaveBeenCalledWith(ORDERS_PATTERNS.ADMIN_LIST_ORDERS, {
      page: 1,
      limit: 20,
      status: undefined,
      actorId: 'admin-1',
      actorRole: 'ADMIN',
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

  it('lights up the customer notification bell for the same change', async () => {
    const { controller, realtime } = createController({
      id: 'order-1',
      userId: 'user-9',
      status: 'ON_DELIVERY',
      updatedAt: '2026-09-16T10:00:00.000Z',
    });

    await controller.updateOrderStatus({ sub: 'courier-1' } as never, 'order-1', {
      status: 'ON_DELIVERY',
    } as never);

    // The notifications service writes the row; without this ping the bell
    // only noticed on the next reload.
    expect(realtime.emitNotification).toHaveBeenCalledWith('user-9');
  });
});

describe('gateway AdminController — catalog', () => {
  it('forwards the category and product bodies, naming who did it', async () => {
    const { controller, products } = createController({ id: 'p1' });

    await controller.createCategory(ACTOR, { name: 'Комбо', slug: 'combo' });
    await controller.createProduct(ACTOR, { name: 'Ойси', slug: 'oisi' } as never);

    // The actor rides along so the catalog can record who changed what; a
    // price change with no author explains nothing months later.
    expect(products).toHaveBeenNthCalledWith(1, PRODUCTS_PATTERNS.ADMIN_CREATE_CATEGORY, {
      name: 'Комбо',
      slug: 'combo',
      actorId: 'admin-1',
    });
    expect(products).toHaveBeenNthCalledWith(2, PRODUCTS_PATTERNS.ADMIN_CREATE_PRODUCT, {
      name: 'Ойси',
      slug: 'oisi',
      actorId: 'admin-1',
    });
  });

  it('splits id and patch when updating, and delists on delete', async () => {
    const { controller, products } = createController({ id: 'p1' });

    await controller.updateProduct(ACTOR, 'p1', { isPopular: true } as never);
    await controller.deleteProduct(ACTOR, 'p1');

    expect(products).toHaveBeenNthCalledWith(1, PRODUCTS_PATTERNS.ADMIN_UPDATE_PRODUCT, {
      productId: 'p1',
      data: { isPopular: true },
      actorId: 'admin-1',
    });
    expect(products).toHaveBeenNthCalledWith(2, PRODUCTS_PATTERNS.ADMIN_DELETE_PRODUCT, {
      productId: 'p1',
      actorId: 'admin-1',
    });
  });
});

describe('gateway AdminController — promocodes and users', () => {
  it('lists and creates promocodes', async () => {
    const { controller, orders } = createController([]);

    await controller.listPromocodes();
    await controller.createPromocode(ACTOR, {
      code: 'CHICAGO10',
      discountType: 'PERCENT',
      discountValue: 10,
    } as never);

    expect(orders).toHaveBeenNthCalledWith(1, ORDERS_PATTERNS.ADMIN_LIST_PROMOCODES, {});
    expect(orders).toHaveBeenNthCalledWith(2, ORDERS_PATTERNS.ADMIN_CREATE_PROMOCODE, {
      code: 'CHICAGO10',
      discountType: 'PERCENT',
      discountValue: 10,
      actorId: 'admin-1',
    });
  });

  it('passes the user search through', async () => {
    const { controller, auth } = createController({ items: [] });

    await controller.listUsers(query(AdminUserQueryDto, { search: 'амина' }));

    expect(auth).toHaveBeenCalledWith(AUTH_PATTERNS.ADMIN_LIST_USERS, { page: 1, limit: 20, search: 'амина' });
  });

  it('defaults the user list to the first page of twenty', async () => {
    const { controller, auth } = createController({ items: [] });

    await controller.listUsers(query(AdminUserQueryDto));

    expect(auth).toHaveBeenCalledWith(AUTH_PATTERNS.ADMIN_LIST_USERS, {
      page: 1,
      limit: 20,
      search: undefined,
    });
  });

  it('sets a role and a block flag, naming who did it', async () => {
    const { controller, auth } = createController({ id: 'user-1' });
    const actor = { sub: 'admin-1', email: 'a@b.ru', role: 'ADMIN' } as never;

    await controller.setUserRole(actor, 'user-1', { role: 'COURIER' as never });
    await controller.setUserBlocked(actor, 'user-1', { isBlocked: true });

    // The auth service needs the actor to refuse self-demotion and the
    // removal of the last administrator.
    expect(auth).toHaveBeenNthCalledWith(1, AUTH_PATTERNS.ADMIN_SET_ROLE, {
      userId: 'user-1',
      role: 'COURIER',
      actorId: 'admin-1',
    });
    expect(auth).toHaveBeenNthCalledWith(2, AUTH_PATTERNS.ADMIN_SET_BLOCKED, {
      userId: 'user-1',
      isBlocked: true,
      actorId: 'admin-1',
    });
  });
});

describe('gateway AdminController — support inbox', () => {
  it('defaults the inbox to the first page of twenty', async () => {
    const { controller, support } = createController({ items: [] });

    await controller.listTickets(query(AdminTicketQueryDto));

    expect(support).toHaveBeenCalledWith(SUPPORT_PATTERNS.ADMIN_LIST_TICKETS, {
      page: 1,
      limit: 20,
      status: undefined,
    });
  });

  it('forwards pagination and the status filter', async () => {
    const { controller, support } = createController({ items: [] });

    await controller.listTickets(query(AdminTicketQueryDto, { page: 3, limit: 5, status: 'OPEN' }));

    expect(support).toHaveBeenCalledWith(SUPPORT_PATTERNS.ADMIN_LIST_TICKETS, {
      page: 3,
      limit: 5,
      status: 'OPEN',
    });
  });
});
