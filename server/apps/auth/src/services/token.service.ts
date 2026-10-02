import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService, User } from '@chicago-pizza/prisma';
import { JwtPayload, RedisCacheService } from '@chicago-pizza/common';
import { createHash, randomBytes } from 'crypto';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenTtl: string;
  refreshTokenExpiresAt: Date;
}

/**
 * How long the pair produced by a rotation is remembered, so that a *second*
 * request presenting the same refresh token gets the same answer instead of
 * being mistaken for an attacker.
 *
 * Short on purpose: this is the width of the window in which two requests can
 * honestly be the same rotation — two tabs restored together, a navigation
 * and the fetch it kicked off. Anything later is a token being replayed.
 */
const ROTATION_GRACE_SECONDS = 30;

/** How long a loser of the race waits for the winner to publish its pair. */
const GRACE_WAIT_ATTEMPTS = 10;
const GRACE_WAIT_MS = 50;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The pair a rotation produced, as it survives a trip through Redis. */
interface StoredPair {
  accessToken: string;
  refreshToken: string;
  accessTokenTtl: string;
  refreshTokenExpiresAt: string;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly cache: RedisCacheService,
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
   * is issued.
   *
   * Two requests can present the same token for two very different reasons,
   * and telling them apart is the whole job here.
   *
   * One is an attacker replaying a token they stole; that has to end every
   * session the account has. The other is the ordinary browser: the access
   * cookie expires on a timer, so two tabs waking together — or a navigation
   * and the fetches it triggers — all notice at the same instant and all send
   * the same refresh cookie. Treating that as an attack logged real customers
   * out of everything, roughly a quarter of an hour into every visit, and the
   * harder they used the site the sooner it happened.
   *
   * So the winner of the race publishes the pair it issued, keyed by the hash
   * of the token that was spent, for a few seconds. A second request finds it
   * and gets the *same* pair — one rotation, one new token, however many
   * callers asked for it. Only a request that arrives with nothing waiting for
   * it is a replay.
   *
   * This does narrow reuse detection, and the trade is deliberate: a token
   * replayed within `ROTATION_GRACE_SECONDS` of its own rotation now succeeds
   * instead of burning the family. What is given up is a thirty-second window
   * an attacker has to hit exactly; what is bought back is every customer who
   * keeps two tabs open. Replay outside the window — which is what exfiltrated
   * tokens actually look like, since they are used minutes or days later — is
   * caught exactly as before.
   *
   * The grace entry holds a live refresh token, which is why it is keyed by
   * the digest of the old one (you must already hold that token to find it)
   * and why it expires in seconds rather than minutes. A logout inside the
   * window revokes the published token in the database, so what an attacker
   * could still read out of it is a session that no longer refreshes.
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

    // Revoking conditionally is what serialises the rotation: exactly one
    // caller wins the update and does the work. Checking `revokedAt` first and
    // updating afterwards would let two parallel refreshes both mint a pair,
    // leaving one of the two tokens unrevoked and untracked.
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (count === 0) {
      const shared = await this.awaitRotation(tokenHash);
      if (shared) return shared;

      await this.revokeAllForUser(stored.userId);
      throw new UnauthorizedException('Обнаружено повторное использование токена — все сессии завершены');
    }

    const pair = await this.issueTokenPair(stored.user, context);
    await this.publishRotation(tokenHash, pair);
    return pair;
  }

  /** Makes the pair this rotation produced available to whoever lost the race. */
  private async publishRotation(spentTokenHash: string, pair: TokenPair): Promise<void> {
    await this.cache.set(this.rotationKey(spentTokenHash), pair, ROTATION_GRACE_SECONDS);
  }

  /**
   * Looks for the pair the winner published, waiting briefly for it.
   *
   * The wait matters: losing the database update and reading Redis are not one
   * step, so a loser can arrive between the winner's `updateMany` and its
   * write. Failing immediately there would call a legitimate second tab a
   * replay — the exact bug this method exists to prevent, just with a much
   * smaller window. A few polls close it; giving up after them is what still
   * catches a real replay.
   */
  private async awaitRotation(spentTokenHash: string): Promise<TokenPair | null> {
    const key = this.rotationKey(spentTokenHash);

    for (let attempt = 0; attempt < GRACE_WAIT_ATTEMPTS; attempt += 1) {
      const stored = await this.cache.get<StoredPair>(key);
      // JSON has no Date, so the expiry comes back as a string; the cookie
      // layer needs a real one.
      if (stored) return { ...stored, refreshTokenExpiresAt: new Date(stored.refreshTokenExpiresAt) };
      await sleep(GRACE_WAIT_MS);
    }

    return null;
  }

  private rotationKey(spentTokenHash: string): string {
    return `auth:rotated:${spentTokenHash}`;
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
