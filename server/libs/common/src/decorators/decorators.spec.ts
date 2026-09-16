import { ExecutionContext } from '@nestjs/common';
import { Role } from '@chicago-pizza/prisma';
import { CurrentUser } from './current-user.decorator';
import { IS_PUBLIC_KEY, Public } from './public.decorator';
import { ROLES_KEY, Roles } from './roles.decorator';

/**
 * A param decorator is only reachable through the metadata Nest stores on the
 * controller, so the factory is pulled back out the way Nest itself does it.
 */
function factoryOf(decorator: (...args: unknown[]) => ParameterDecorator) {
  class Probe {
    handler(@decorator() value: unknown) {
      return value;
    }
  }

  const args = Reflect.getMetadata('__routeArguments__', Probe, 'handler');
  return args[Object.keys(args)[0]].factory as (data: unknown, ctx: ExecutionContext) => unknown;
}

const contextWith = (user: unknown) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as unknown as ExecutionContext;

describe('@CurrentUser()', () => {
  const factory = factoryOf(CurrentUser as unknown as (...args: unknown[]) => ParameterDecorator);
  const user = { sub: 'user-1', email: 'a@b.ru', role: Role.USER };

  it('returns the whole payload when asked for no field', () => {
    expect(factory(undefined, contextWith(user))).toEqual(user);
  });

  it.each([
    ['sub', 'user-1'],
    ['email', 'a@b.ru'],
    ['role', Role.USER],
  ])('picks the %s field', (field, expected) => {
    expect(factory(field, contextWith(user))).toBe(expected);
  });

  it('returns undefined for an anonymous request', () => {
    expect(factory(undefined, contextWith(undefined))).toBeUndefined();
  });

  it('does not blow up asking for a field of an absent user', () => {
    expect(factory('sub', contextWith(undefined))).toBeUndefined();
  });
});

describe('@Public()', () => {
  it('marks the handler with the flag JwtAuthGuard looks for', () => {
    class Probe {
      @Public()
      handler() {
        return null;
      }
    }

    expect(Reflect.getMetadata(IS_PUBLIC_KEY, Probe.prototype.handler)).toBe(true);
  });

  it('can be applied to a whole controller', () => {
    @Public()
    class Probe {}

    expect(Reflect.getMetadata(IS_PUBLIC_KEY, Probe)).toBe(true);
  });
});

describe('@Roles()', () => {
  it('stores the allowed roles for RolesGuard', () => {
    class Probe {
      @Roles(Role.ADMIN, Role.SUPPORT)
      handler() {
        return null;
      }
    }

    expect(Reflect.getMetadata(ROLES_KEY, Probe.prototype.handler)).toEqual([Role.ADMIN, Role.SUPPORT]);
  });

  it('stores an empty list when called without roles', () => {
    class Probe {
      @Roles()
      handler() {
        return null;
      }
    }

    expect(Reflect.getMetadata(ROLES_KEY, Probe.prototype.handler)).toEqual([]);
  });
});
