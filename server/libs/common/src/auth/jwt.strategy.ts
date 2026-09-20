import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { RedisCacheService } from '../redis/redis-cache.service';
import { JwtPayload } from '../types/jwt-payload.interface';
import { isSessionRevoked } from './session-revocation';

function cookieExtractor(req: Request): string | null {
  return req?.cookies?.access_token ?? null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly cache: RedisCacheService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([cookieExtractor, ExtractJwt.fromAuthHeaderAsBearerToken()]),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET')!,
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    // A valid signature is not enough: the account may have been blocked or
    // demoted since this token was issued.
    if (await isSessionRevoked(this.cache, payload)) {
      throw new UnauthorizedException('Session revoked');
    }

    return payload;
  }
}
