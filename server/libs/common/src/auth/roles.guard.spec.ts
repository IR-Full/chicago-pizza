import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@chicago-pizza/prisma';
import { RolesGuard } from './roles.guard';

function contextFor(user: unknown): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function guardRequiring(roles: Role[] | undefined) {
  const reflector = { getAllAndOverride: jest.fn(() => roles) } as unknown as Reflector;
  return { guard: new RolesGuard(reflector), reflector };
}

/**
 * The single gate between a customer account and the admin panel — every
 * branch here is a potential privilege escalation.
 */
describe('RolesGuard', () => {
  it('lets an unannotated route through', () => {
    const { guard } = guardRequiring(undefined);

    expect(guard.canActivate(contextFor(undefined))).toBe(true);
  });

  it('treats an empty role list as unrestricted', () => {
    const { guard } = guardRequiring([]);

    expect(guard.canActivate(contextFor(undefined))).toBe(true);
  });

  it('admits a user holding the required role', () => {
    const { guard } = guardRequiring([Role.ADMIN]);

    expect(guard.canActivate(contextFor({ sub: 'u1', role: Role.ADMIN }))).toBe(true);
  });

  it('admits a user holding any one of several roles', () => {
    const { guard } = guardRequiring([Role.ADMIN, Role.SUPPORT]);

    expect(guard.canActivate(contextFor({ sub: 'u1', role: Role.SUPPORT }))).toBe(true);
  });

  it('rejects a customer reaching for a staff route', () => {
    const { guard } = guardRequiring([Role.ADMIN]);

    expect(() => guard.canActivate(contextFor({ sub: 'u1', role: Role.USER }))).toThrow(ForbiddenException);
  });

  it('rejects a courier reaching for the support inbox', () => {
    const { guard } = guardRequiring([Role.SUPPORT]);

    expect(() => guard.canActivate(contextFor({ sub: 'u1', role: Role.COURIER }))).toThrow(ForbiddenException);
  });

  it('rejects an anonymous request even when the token is merely absent', () => {
    const { guard } = guardRequiring([Role.ADMIN]);

    expect(() => guard.canActivate(contextFor(undefined))).toThrow(ForbiddenException);
  });

  it('reads the metadata from both the handler and the controller', () => {
    const { guard, reflector } = guardRequiring([Role.ADMIN]);
    const context = contextFor({ role: Role.ADMIN });

    guard.canActivate(context);

    expect(reflector.getAllAndOverride).toHaveBeenCalledWith('roles', [expect.any(Function), expect.any(Function)]);
  });
});
