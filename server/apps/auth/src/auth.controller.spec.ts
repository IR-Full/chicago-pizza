import { AUTH_PATTERNS } from '@chicago-pizza/common';
import { AuthController } from './auth.controller';
import { AuthService } from './services/auth.service';
import { AddressService } from './services/address.service';
import { PrivacyService } from './services/privacy.service';

function createController() {
  const auth: Record<string, any> = {
    register: jest.fn(async () => ({ user: { id: 'user-1' } })),
    login: jest.fn(async () => ({ user: { id: 'user-1' }, tokens: {} })),
    refresh: jest.fn(async () => ({ tokens: {} })),
    logout: jest.fn(async () => ({ success: true })),
    verifyEmail: jest.fn(async () => ({ verified: true })),
    resendVerification: jest.fn(async () => ({ sent: true })),
    requestPasswordReset: jest.fn(async () => ({ sent: true })),
    resetPassword: jest.fn(async () => ({ success: true })),
    getProfile: jest.fn(async () => ({ id: 'user-1' })),
    updateProfile: jest.fn(async () => ({ id: 'user-1' })),
    adminListUsers: jest.fn(async () => ({ items: [] })),
    adminSetRole: jest.fn(async () => ({ id: 'user-1' })),
    adminSetBlocked: jest.fn(async () => ({ id: 'user-1' })),
  };
  const addresses: Record<string, any> = {
    list: jest.fn(async () => []),
    create: jest.fn(async () => ({ id: 'addr-1' })),
    update: jest.fn(async () => ({ id: 'addr-1' })),
    remove: jest.fn(async () => ({ success: true })),
  };

  const privacy = {
    listSessions: jest.fn(async () => []),
    revokeSession: jest.fn(async () => ({ success: true })),
    exportData: jest.fn(async () => ({ profile: {} })),
    deleteAccount: jest.fn(async () => ({ success: true })),
  };

  return {
    controller: new AuthController(
      auth as unknown as AuthService,
      addresses as unknown as AddressService,
      privacy as unknown as PrivacyService,
    ),
    auth,
    addresses,
    privacy,
  };
}

/** Nest stores the RabbitMQ pattern of a handler in this metadata key. */
function patternOf(method: keyof AuthController): string[] {
  const meta = Reflect.getMetadata('microservices:pattern', AuthController.prototype[method]);
  return ([] as string[]).concat(meta);
}

describe('AuthController — message routing', () => {
  it.each([
    ['register', AUTH_PATTERNS.REGISTER],
    ['login', AUTH_PATTERNS.LOGIN],
    ['refresh', AUTH_PATTERNS.REFRESH],
    ['logout', AUTH_PATTERNS.LOGOUT],
    ['verifyEmail', AUTH_PATTERNS.VERIFY_EMAIL],
    ['resendVerification', AUTH_PATTERNS.RESEND_VERIFICATION],
    ['requestPasswordReset', AUTH_PATTERNS.REQUEST_PASSWORD_RESET],
    ['resetPassword', AUTH_PATTERNS.RESET_PASSWORD],
    ['getProfile', AUTH_PATTERNS.GET_PROFILE],
    ['updateProfile', AUTH_PATTERNS.UPDATE_PROFILE],
    ['getUserById', AUTH_PATTERNS.GET_USER_BY_ID],
    ['listAddresses', AUTH_PATTERNS.LIST_ADDRESSES],
    ['createAddress', AUTH_PATTERNS.CREATE_ADDRESS],
    ['updateAddress', AUTH_PATTERNS.UPDATE_ADDRESS],
    ['deleteAddress', AUTH_PATTERNS.DELETE_ADDRESS],
    ['adminListUsers', AUTH_PATTERNS.ADMIN_LIST_USERS],
    ['adminSetRole', AUTH_PATTERNS.ADMIN_SET_ROLE],
    ['adminSetBlocked', AUTH_PATTERNS.ADMIN_SET_BLOCKED],
  ])('%s listens on %s', (method, pattern) => {
    expect(patternOf(method as keyof AuthController)).toContain(pattern);
  });
});

describe('AuthController — delegation', () => {
  it('passes the registration payload straight through', async () => {
    const { controller, auth } = createController();
    const dto = { email: 'a@b.ru', password: 'Password1', firstName: 'Амина' };

    await controller.register(dto as never);

    expect(auth.register).toHaveBeenCalledWith(dto);
  });

  it('splits the request context out of the login payload', async () => {
    const { controller, auth } = createController();

    await controller.login({
      email: 'a@b.ru',
      password: 'Password1',
      ip: '10.0.0.5',
      userAgent: 'Firefox',
    } as never);

    // Credentials and context must not be mixed, or the DTO would carry
    // transport fields into the service.
    expect(auth.login).toHaveBeenCalledWith(
      { email: 'a@b.ru', password: 'Password1' },
      { ip: '10.0.0.5', userAgent: 'Firefox' },
    );
  });

  it('forwards the refresh token with its context', async () => {
    const { controller, auth } = createController();

    await controller.refresh({ refreshToken: 'r1', ip: '10.0.0.5', userAgent: 'Safari' } as never);

    expect(auth.refresh).toHaveBeenCalledWith('r1', { ip: '10.0.0.5', userAgent: 'Safari' });
  });

  it('unwraps the refresh token for logout', async () => {
    const { controller, auth } = createController();

    await controller.logout({ refreshToken: 'r1' });

    expect(auth.logout).toHaveBeenCalledWith('r1');
  });

  it.each([
    ['verifyEmail', { email: 'a@b.ru', code: '123456' }],
    ['resendVerification', { email: 'a@b.ru' }],
    ['requestPasswordReset', { email: 'a@b.ru' }],
    ['resetPassword', { token: 't', newPassword: 'NewPass1' }],
  ])('forwards the %s payload unchanged', async (method, payload) => {
    const { controller, auth } = createController();

    await (controller as never as Record<string, (p: unknown) => Promise<unknown>>)[method](payload);

    expect(auth[method]).toHaveBeenCalledWith(payload);
  });

  it('reads the profile of the requested user', async () => {
    const { controller, auth } = createController();

    await controller.getProfile({ userId: 'user-9' });
    await controller.getUserById({ userId: 'user-9' });

    expect(auth.getProfile).toHaveBeenNthCalledWith(1, 'user-9');
    expect(auth.getProfile).toHaveBeenNthCalledWith(2, 'user-9');
  });

  it('splits user id and patch when updating a profile', async () => {
    const { controller, auth } = createController();

    await controller.updateProfile({ userId: 'user-1', dto: { firstName: 'Патимат' } as never });

    expect(auth.updateProfile).toHaveBeenCalledWith('user-1', { firstName: 'Патимат' });
  });

  describe('addresses', () => {
    it('lists for the payload user', async () => {
      const { controller, addresses } = createController();

      await controller.listAddresses({ userId: 'user-1' });

      expect(addresses.list).toHaveBeenCalledWith('user-1');
    });

    it('creates with the owner separated from the body', async () => {
      const { controller, addresses } = createController();

      await controller.createAddress({ userId: 'user-1', dto: { street: 'Ленина' } as never });

      expect(addresses.create).toHaveBeenCalledWith('user-1', { street: 'Ленина' });
    });

    it('updates by owner and address id', async () => {
      const { controller, addresses } = createController();

      await controller.updateAddress({ userId: 'user-1', addressId: 'addr-1', dto: { house: '7' } as never });

      expect(addresses.update).toHaveBeenCalledWith('user-1', 'addr-1', { house: '7' });
    });

    it('deletes by owner and address id', async () => {
      const { controller, addresses } = createController();

      await controller.deleteAddress({ userId: 'user-1', addressId: 'addr-1' });

      expect(addresses.remove).toHaveBeenCalledWith('user-1', 'addr-1');
    });
  });

  describe('admin', () => {
    it('passes the pagination payload through', async () => {
      const { controller, auth } = createController();

      await controller.adminListUsers({ page: 2, limit: 20, search: 'амина' });

      expect(auth.adminListUsers).toHaveBeenCalledWith({ page: 2, limit: 20, search: 'амина' });
    });

    it('sets a role, carrying who is doing it', async () => {
      const { controller, auth } = createController();

      await controller.adminSetRole({ userId: 'user-1', role: 'COURIER' as never, actorId: 'admin-1' });

      // The actor is needed to stop an admin from demoting themselves.
      expect(auth.adminSetRole).toHaveBeenCalledWith('user-1', 'COURIER', 'admin-1');
    });

    it('blocks and unblocks, carrying who is doing it', async () => {
      const { controller, auth } = createController();

      await controller.adminSetBlocked({ userId: 'user-1', isBlocked: true, actorId: 'admin-1' });
      await controller.adminSetBlocked({ userId: 'user-1', isBlocked: false, actorId: 'admin-1' });

      expect(auth.adminSetBlocked).toHaveBeenNthCalledWith(1, 'user-1', true, 'admin-1');
      expect(auth.adminSetBlocked).toHaveBeenNthCalledWith(2, 'user-1', false, 'admin-1');
    });
  });
});
