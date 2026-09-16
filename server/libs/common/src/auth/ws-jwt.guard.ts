import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';
import * as cookie from 'cookie';
import { JwtPayload } from '../types/jwt-payload.interface';

/**
 * Authenticates a Socket.IO handshake using the same `access_token` httpOnly
 * cookie the REST API uses, so the browser client needs no extra wiring.
 */
@Injectable()
export class WsJwtGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const client = context.switchToWs().getClient<Socket>();
    const token = this.extractToken(client);
    if (!token) throw new UnauthorizedException('Missing auth token');

    try {
      const payload = this.jwtService.verify<JwtPayload>(token);
      (client.data as Record<string, unknown>).user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  private extractToken(client: Socket): string | null {
    const authToken = client.handshake.auth?.token as string | undefined;
    if (authToken) return authToken;

    const rawCookie = client.handshake.headers.cookie;
    if (!rawCookie) return null;
    const parsed = cookie.parse(rawCookie);
    return parsed.access_token ?? null;
  }
}
