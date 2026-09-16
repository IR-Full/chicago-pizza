import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WsJwtGuard } from './ws-jwt.guard';

interface FakeSocket {
  handshake: { auth?: Record<string, unknown>; headers: Record<string, string | undefined> };
  data: Record<string, unknown>;
}

function socket(handshake: Partial<FakeSocket['handshake']>): FakeSocket {
  return { handshake: { headers: {}, ...handshake }, data: {} };
}

function contextFor(client: FakeSocket): ExecutionContext {
  return { switchToWs: () => ({ getClient: () => client }) } as unknown as ExecutionContext;
}

function guardWith(verify: jest.Mock) {
  return new WsJwtGuard({ verify } as unknown as JwtService);
}

const PAYLOAD = { sub: 'user-1', email: 'a@b.ru', role: 'USER' };

describe('WsJwtGuard', () => {
  it('accepts the token from the handshake auth field', () => {
    const verify = jest.fn(() => PAYLOAD);
    const client = socket({ auth: { token: 'tok' } });

    expect(guardWith(verify).canActivate(contextFor(client))).toBe(true);
    expect(verify).toHaveBeenCalledWith('tok');
  });

  it('falls back to the access_token cookie the REST API already sets', () => {
    const verify = jest.fn(() => PAYLOAD);
    const client = socket({ headers: { cookie: 'refresh_token=r; access_token=abc123' } });

    expect(guardWith(verify).canActivate(contextFor(client))).toBe(true);
    expect(verify).toHaveBeenCalledWith('abc123');
  });

  it('prefers the explicit auth token over the cookie', () => {
    const verify = jest.fn(() => PAYLOAD);
    const client = socket({ auth: { token: 'explicit' }, headers: { cookie: 'access_token=cookie' } });

    guardWith(verify).canActivate(contextFor(client));

    expect(verify).toHaveBeenCalledWith('explicit');
  });

  it('publishes the payload on socket.data for the gateway handlers', () => {
    const client = socket({ auth: { token: 'tok' } });

    guardWith(jest.fn(() => PAYLOAD)).canActivate(contextFor(client));

    expect(client.data.user).toEqual(PAYLOAD);
  });

  it.each([
    ['no auth and no cookie header', {}],
    ['an empty auth object', { auth: {} }],
    ['a cookie header without the access token', { headers: { cookie: 'refresh_token=r' } }],
  ])('rejects a handshake with %s', (_label, handshake) => {
    expect(() => guardWith(jest.fn()).canActivate(contextFor(socket(handshake)))).toThrow(
      new UnauthorizedException('Missing auth token'),
    );
  });

  it('rejects a token the signer does not recognise', () => {
    const verify = jest.fn(() => {
      throw new Error('invalid signature');
    });

    expect(() => guardWith(verify).canActivate(contextFor(socket({ auth: { token: 'forged' } })))).toThrow(
      new UnauthorizedException('Invalid or expired token'),
    );
  });

  it('leaves socket.data untouched when verification fails', () => {
    const client = socket({ auth: { token: 'forged' } });
    const verify = jest.fn(() => {
      throw new Error('jwt expired');
    });

    expect(() => guardWith(verify).canActivate(contextFor(client))).toThrow(UnauthorizedException);
    expect(client.data.user).toBeUndefined();
  });
});
