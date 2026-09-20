import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService, User } from '@chicago-pizza/prisma';
import { JwtPayload } from '@chicago-pizza/common';
import { createHash, randomBytes } from 'crypto';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenTtl: string;
  refreshTokenExpiresAt: Date;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Refresh tokens are opaque random strings; only their SHA-256 hash is
   * persisted, so a database leak cannot be replayed against the API.
   */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async issueTokenPair(
    user: Pick<User, 'id' | 'email' | 'role'>,
    context: { ip?: string; userAgent?: string } = {},
  ): Promise<TokenPair> {
    const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role };
    const accessTokenTtl = this.config.get<string>('JWT_ACCESS_TTL')!;
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      // jsonwebtoken types `expiresIn` as a `${number}${unit}` template
      // literal. The value arrives from the environment as a plain string —
      // `env.ts` is what guarantees its shape — so the narrowing happens here
      // rather than being spread across every call site.
      expiresIn: accessTokenTtl as JwtSignOptions['expiresIn'],
    });

    const refreshToken = randomBytes(48).toString('hex');
    const refreshDays = this.config.get<number>('JWT_REFRESH_TTL_DAYS')!;
    const refreshTokenExpiresAt = new Date(Date.now() + refreshDays * 24 * 60 * 60 * 1000);

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: refreshTokenExpiresAt,
        ip: context.ip,
        userAgent: context.userAgent,
      },
    });

    return { accessToken, refreshToken, accessTokenTtl, refreshTokenExpiresAt };
  }

  /**
   * Rotates a refresh token: the presented token is revoked and a fresh pair
   * is issued. If a token that was already revoked is presented, we treat it
   * as a replay attack and revoke the user's entire token family.
   */
  async rotate(refreshToken: string, context: { ip?: string; userAgent?: string } = {}): Promise<TokenPair> {
    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!stored) throw new UnauthorizedException('Недействительный refresh-токен');

    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Срок действия сессии истёк — войдите заново');
    }

    if (stored.user.isBlocked) {
      throw new UnauthorizedException('Аккаунт заблокирован');
    }

    // Revoking conditionally is what makes rotation safe: whoever wins this
    // update gets the new pair, everyone else sees count === 0 and is treated
    // as a replay. Checking `revokedAt` first and updating afterwards let two
    // parallel refreshes (two tabs, a retried request) both succeed — which is
    // exactly the case reuse detection exists to catch.
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (count === 0) {
      await this.revokeAllForUser(stored.userId);
      throw new UnauthorizedException('Обнаружено повторное использование токена — все сессии завершены');
    }

    return this.issueTokenPair(stored.user, context);
  }

  async revoke(refreshToken: string): Promise<void> {
    const tokenHash = this.hashToken(refreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
