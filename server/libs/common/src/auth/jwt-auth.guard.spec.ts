import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

// `AuthGuard('jwt')` is a mixin class; its prototype sits one level above the
// guard we are testing, which is where passport's canActivate lives.
const passportPrototype = Object.getPrototypeOf(JwtAuthGuard.prototype);

function context(): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => ({}) }),
  } as unknown as ExecutionContext;
}

function guardFor(isPublic: boolean | undefined) {
  const reflector = { getAllAndOverride: jest.fn(() => isPublic) } as unknown as Reflector;
  return new JwtAuthGuard(reflector);
}

describe('JwtAuthGuard', () => {
  let superCanActivate: jest.SpyInstance;

  beforeEach(() => {
    superCanActivate = jest.spyOn(passportPrototype, 'canActivate');
  });

  afterEach(() => {
    superCanActivate.mockRestore();
  });

  describe('a protected route', () => {
    it('passes when passport validates the token', async () => {
      superCanActivate.mockResolvedValue(true);

      await expect(guardFor(undefined).canActivate(context())).resolves.toBe(true);
    });

    it('propagates passport rejection', async () => {
      superCanActivate.mockRejectedValue(new UnauthorizedException());

      await expect(guardFor(false).canActivate(context())).rejects.toThrow(UnauthorizedException);
    });

    it('returns passport verdict verbatim when it declines without throwing', async () => {
      superCanActivate.mockResolvedValue(false);

      await expect(guardFor(undefined).canActivate(context())).resolves.toBe(false);
    });
  });

  describe('a @Public() route', () => {
    it('still runs passport so a signed-in visitor gets personalised results', async () => {
      superCanActivate.mockResolvedValue(true);

      await expect(guardFor(true).canActivate(context())).resolves.toBe(true);
      expect(superCanActivate).toHaveBeenCalledTimes(1);
    });

    it('lets a guest through when the token is missing or expired', async () => {
      superCanActivate.mockRejectedValue(new UnauthorizedException('jwt expired'));

      // The catalog must stay readable without an account.
      await expect(guardFor(true).canActivate(context())).resolves.toBe(true);
    });

    it('lets a guest through when passport throws synchronously', async () => {
      superCanActivate.mockImplementation(() => {
        throw new Error('malformed token');
      });

      await expect(guardFor(true).canActivate(context())).resolves.toBe(true);
    });
  });

  it('looks the public flag up on the handler and the controller', async () => {
    superCanActivate.mockResolvedValue(true);
    const reflector = { getAllAndOverride: jest.fn(() => true) } as unknown as Reflector;

    await new JwtAuthGuard(reflector).canActivate(context());

    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, [
      expect.any(Function),
      expect.any(Function),
    ]);
  });
});
