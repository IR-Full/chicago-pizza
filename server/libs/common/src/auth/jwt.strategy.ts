import { Injectable, UnauthorizedException, Optional } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { PrismaService } from '@chicago-pizza/prisma';
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
    @Optional() private readonly prisma?: PrismaService,
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

    if (process.env.DEPLOYMENT_MODE === 'public') {
      const user = await this.prisma?.user.findUnique({
        where: { id: payload.sub },
        select: { isBlocked: true, anonymizedAt: true, role: true },
      });
      if (!user || user.isBlocked || user.anonymizedAt || user.role !== payload.role)
        throw new UnauthorizedException('Account or role revoked');
    }
    return payload;
  }
}
