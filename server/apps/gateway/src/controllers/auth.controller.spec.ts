import { UnauthorizedException } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Request, Response } from 'express';
import { of } from 'rxjs';
import { AUTH_PATTERNS, IS_PUBLIC_KEY } from '@chicago-pizza/common';
import { AuthController } from './auth.controller';

const TOKENS = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  refreshTokenExpiresAt: '2026-10-16T12:00:00.000Z',
};

function createController(reply: unknown = { user: { id: 'user-1' }, tokens: TOKENS }) {
  const send = jest.fn(() => of(reply));
  const client = { send } as unknown as ClientProxy;

  return { controller: new AuthController(client), send };
}

const requestOf = (cookies: Record<string, string> = {}): Request =>
  ({ cookies, ip: '10.0.0.5', headers: { 'user-agent': 'Firefox' } }) as unknown as Request;

function responseSpy() {
  const cookie = jest.fn();
  const clearCookie = jest.fn();
  return { res: { cookie, clearCookie } as unknown as Response, cookie, clearCookie };
}

const meta = (key: string, method: keyof AuthController) =>
  Reflect.getMetadata(key, AuthController.prototype[method]);

describe('gateway AuthController — HTTP surface', () => {
  it('is mounted under /auth', () => {
    expect(Reflect.getMetadata('path', AuthController)).toBe('auth');
  });

  it.each([
    ['register', 'register', 1],
    ['login', 'login', 1],
    ['refresh', 'refresh', 1],
    ['logout', 'logout', 1],
    ['verifyEmail', 'verify-email', 1],
    ['resendVerification', 'resend-verification', 1],
    ['requestPasswordReset', 'forgot-password', 1],
    ['resetPassword', 'reset-password', 1],
    ['getProfile', 'me', 0],
    ['updateProfile', 'me', 4],
    ['listAddresses', 'addresses', 0],
    ['createAddress', 'addresses', 1],
    ['updateAddress', 'addresses/:id', 4],
    ['deleteAddress', 'addresses/:id', 3],
  ])('%s handles %s', (method, path, httpMethod) => {
    expect(meta('path', method as keyof AuthController)).toBe(path);
    expect(meta('method', method as keyof AuthController)).toBe(httpMethod);
  });

  it.each([
    ['register'],
    ['login'],
    ['refresh'],
    ['logout'],
    ['verifyEmail'],
    ['resendVerification'],
    ['requestPasswordReset'],
    ['resetPassword'],
  ])('%s is reachable without a session', (method) => {
    expect(meta(IS_PUBLIC_KEY, method as keyof AuthController)).toBe(true);
  });

  it.each([['getProfile'], ['updateProfile'], ['listAddresses'], ['createAddress']])(
    '%s requires a session',
    (method) => {
      expect(meta(IS_PUBLIC_KEY, method as keyof AuthController)).toBeUndefined();
    },
  );

  it.each([
    ['register', 5],
    ['login', 10],
    ['verifyEmail', 5],
    ['resendVerification', 3],
    ['requestPasswordReset', 3],
    ['resetPassword', 5],
  ])('throttles %s to %i per minute', (method, limit) => {
    // These are the brute-force and mail-bomb surfaces; the limits are part of
    // the security contract, not a tuning detail.
    expect(meta('THROTTLER:LIMITdefault', method as keyof AuthController)).toBe(limit);
    expect(meta('THROTTLER:TTLdefault', method as keyof AuthController)).toBe(60_000);
  });
});

describe('gateway AuthController — registration and login', () => {
  it('forwards the registration body', async () => {
    const { controller, send } = createController({ user: { id: 'user-1' } });
    const dto = { email: 'a@b.ru', password: 'Password1', firstName: 'Амина' };

    await controller.register(dto as never);

    expect(send).toHaveBeenCalledWith(AUTH_PATTERNS.REGISTER, dto);
  });

  it('adds the request context to the login call', async () => {
    const { controller, send } = createController();
    const { res } = responseSpy();

    await controller.login({ email: 'a@b.ru', password: 'Password1' } as never, requestOf(), res);

    expect(send).toHaveBeenCalledWith(AUTH_PATTERNS.LOGIN, {
      email: 'a@b.ru',
      password: 'Password1',
      ip: '10.0.0.5',
      userAgent: 'Firefox',
    });
  });

  it('delivers the tokens as httpOnly cookies, never in the body', async () => {
    const { controller } = createController();
    const { res, cookie } = responseSpy();

    const body = await controller.login({ email: 'a@b.ru', password: 'Password1' } as never, requestOf(), res);

    expect(body).toEqual({ user: { id: 'user-1' } });
    expect(JSON.stringify(body)).not.toContain('access-1');
    expect(cookie).toHaveBeenCalledWith('access_token', 'access-1', expect.objectContaining({ httpOnly: true }));
    expect(cookie).toHaveBeenCalledWith('refresh_token', 'refresh-1', expect.objectContaining({ path: '/api/auth' }));
  });
});

describe('gateway AuthController — session refresh and logout', () => {
  it('rejects a refresh without the cookie', async () => {
    const { controller, send } = createController();
    const { res } = responseSpy();

    await expect(controller.refresh(requestOf(), res)).rejects.toThrow(UnauthorizedException);
    expect(send).not.toHaveBeenCalled();
  });

  it('rotates the pair and re-sets both cookies', async () => {
    const { controller, send } = createController({ tokens: TOKENS });
    const { res, cookie } = responseSpy();

    await expect(controller.refresh(requestOf({ refresh_token: 'old' }), res)).resolves.toEqual({ success: true });

    expect(send).toHaveBeenCalledWith(AUTH_PATTERNS.REFRESH, {
      refreshToken: 'old',
      ip: '10.0.0.5',
      userAgent: 'Firefox',
    });
    expect(cookie).toHaveBeenCalledTimes(2);
  });

  it('revokes the token server-side on logout', async () => {
    const { controller, send } = createController({ success: true });
    const { res, clearCookie } = responseSpy();

    await expect(controller.logout(requestOf({ refresh_token: 'old' }), res)).resolves.toEqual({ success: true });

    expect(send).toHaveBeenCalledWith(AUTH_PATTERNS.LOGOUT, { refreshToken: 'old' });
    expect(clearCookie).toHaveBeenCalledTimes(2);
  });

  it('still clears the cookies when there was no session', async () => {
    const { controller, send } = createController();
    const { res, clearCookie } = responseSpy();

    await expect(controller.logout(requestOf(), res)).resolves.toEqual({ success: true });

    expect(send).not.toHaveBeenCalled();
    expect(clearCookie).toHaveBeenCalledTimes(2);
  });
});

describe('gateway AuthController — account endpoints', () => {
  it.each([
    ['verifyEmail', AUTH_PATTERNS.VERIFY_EMAIL, { email: 'a@b.ru', code: '123456' }],
    ['resendVerification', AUTH_PATTERNS.RESEND_VERIFICATION, { email: 'a@b.ru' }],
    ['requestPasswordReset', AUTH_PATTERNS.REQUEST_PASSWORD_RESET, { email: 'a@b.ru' }],
    ['resetPassword', AUTH_PATTERNS.RESET_PASSWORD, { token: 't', newPassword: 'NewPass1' }],
  ])('%s forwards its body to %s', async (method, pattern, dto) => {
    const { controller, send } = createController({ ok: true });

    await (controller as never as Record<string, (body: unknown) => unknown>)[method](dto);

    expect(send).toHaveBeenCalledWith(pattern, dto);
  });

  it('reads the profile of the authenticated user, not a body field', async () => {
    const { controller, send } = createController({ id: 'user-1' });

    await controller.getProfile({ sub: 'user-1', email: 'a@b.ru', role: 'USER' } as never);

    expect(send).toHaveBeenCalledWith(AUTH_PATTERNS.GET_PROFILE, { userId: 'user-1' });
  });

  it('updates the profile of the authenticated user', async () => {
    const { controller, send } = createController({ id: 'user-1' });

    await controller.updateProfile({ sub: 'user-1' } as never, { firstName: 'Патимат' } as never);

    expect(send).toHaveBeenCalledWith(AUTH_PATTERNS.UPDATE_PROFILE, {
      userId: 'user-1',
      dto: { firstName: 'Патимат' },
    });
  });
});

describe('gateway AuthController — addresses', () => {
  it('lists the caller’s addresses', async () => {
    const { controller, send } = createController([]);

    await controller.listAddresses({ sub: 'user-1' } as never);

    expect(send).toHaveBeenCalledWith(AUTH_PATTERNS.LIST_ADDRESSES, { userId: 'user-1' });
  });

  it('creates, updates and deletes scoped to the caller', async () => {
    const { controller, send } = createController({ id: 'addr-1' });

    await controller.createAddress({ sub: 'user-1' } as never, { street: 'Ленина' } as never);
    await controller.updateAddress({ sub: 'user-1' } as never, 'addr-1', { house: '7' } as never);
    await controller.deleteAddress({ sub: 'user-1' } as never, 'addr-1');

    expect(send).toHaveBeenNthCalledWith(1, AUTH_PATTERNS.CREATE_ADDRESS, {
      userId: 'user-1',
      dto: { street: 'Ленина' },
    });
    expect(send).toHaveBeenNthCalledWith(2, AUTH_PATTERNS.UPDATE_ADDRESS, {
      userId: 'user-1',
      addressId: 'addr-1',
      dto: { house: '7' },
    });
    expect(send).toHaveBeenNthCalledWith(3, AUTH_PATTERNS.DELETE_ADDRESS, {
      userId: 'user-1',
      addressId: 'addr-1',
    });
  });
});
