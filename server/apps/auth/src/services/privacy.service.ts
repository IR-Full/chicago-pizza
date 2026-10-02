import { ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import { AdminAction, PrismaService, Role } from '@chicago-pizza/prisma';
import {
  ORDERS_PATTERNS,
  parseTtlSeconds,
  RedisCacheService,
  revokeSessionsBefore,
  rpcSend,
  shortId,
  SUPPORT_PATTERNS,
} from '@chicago-pizza/common';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { TokenService } from './token.service';

/** One live sign-in, as the customer sees it in their profile. */
export interface SessionView {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
  expiresAt: Date;
  /** The session making the request, which the UI marks and refuses to kill. */
  isCurrent: boolean;
}

/**
 * The rights side of personal-data law, implemented rather than described.
 *
 * `ip` and `userAgent` were already being written on every sign-in but never
 * shown to anyone — data collected for a purpose nobody could act on. The
 * session list turns that into the thing it was for: noticing a login you do
 * not recognise and ending it.
 *
 * Erasure is the harder half. Orders cannot simply be deleted — they are
 * accounting records with their own retention period — so the account is
 * anonymised instead: every field that names a person is overwritten in
 * place, and what remains is a row of figures that belongs to nobody.
 */
@Injectable()
export class PrivacyService {
  private readonly logger = new Logger(PrivacyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly tokens: TokenService,
    private readonly cache: RedisCacheService,
    @Inject('ORDERS_SERVICE') private readonly orders: ClientProxy,
    @Inject('SUPPORT_SERVICE') private readonly support: ClientProxy,
  ) {}

  // ── Sessions ─────────────────────────────────────────────────

  async listSessions(userId: string, currentTokenHash?: string): Promise<SessionView[]> {
    const sessions = await this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });

    return sessions.map((session) => ({
      id: session.id,
      ip: session.ip,
      userAgent: session.userAgent,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      isCurrent: currentTokenHash !== undefined && session.tokenHash === currentTokenHash,
    }));
  }

  /**
   * Ends one session. The caller's own session is refused on purpose: signing
   * yourself out is what the logout button does, and letting it happen here
   * makes "I killed the wrong one" a confusing experience instead of a clear
   * refusal.
   */
  async revokeSession(
    userId: string,
    sessionId: string,
    currentTokenHash?: string,
  ): Promise<{ success: true }> {
    const session = await this.prisma.refreshToken.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== userId) throw new NotFoundException('Сессия не найдена');
    if (currentTokenHash !== undefined && session.tokenHash === currentTokenHash) {
      throw new ForbiddenException('Это текущая сессия — используйте выход из аккаунта');
    }

    await this.prisma.refreshToken.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { success: true };
  }

  // ── Export ───────────────────────────────────────────────────

  /**
   * Everything the service holds about one person, in one file.
   *
   * Assembled across services rather than read from one database: each
   * domain knows which of its columns describe a person and which are
   * internal bookkeeping, and only it should decide what belongs in the copy.
   */
  async exportData(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { addresses: true },
    });
    if (!user) throw new NotFoundException('Пользователь не найден');

    const [orders, support] = await Promise.all([
      rpcSend<unknown>(this.orders, ORDERS_PATTERNS.EXPORT_DATA, { userId }),
      rpcSend<unknown>(this.support, SUPPORT_PATTERNS.EXPORT_DATA, { userId }),
    ]);

    const sessions = await this.listSessions(userId);

    return {
      exportedAt: new Date().toISOString(),
      profile: {
        email: user.email,
        phone: user.phone,
        firstName: user.firstName,
        lastName: user.lastName,
        locale: user.locale,
        referralCode: user.referralCode,
        loyaltyPoints: user.loyaltyPoints,
        loyaltyLevel: user.loyaltyLevel,
        isEmailVerified: user.isEmailVerified,
        registeredAt: user.createdAt,
        consent: { version: user.consentVersion, acceptedAt: user.consentAcceptedAt },
      },
      addresses: user.addresses,
      // The password hash is deliberately absent: it is ours, not theirs, and
      // handing it out turns a lost export file into an offline cracking job.
      sessions: sessions.map(({ ip, userAgent, createdAt, expiresAt }) => ({
        ip,
        userAgent,
        createdAt,
        expiresAt,
      })),
      orders,
      support,
    };
  }

  // ── Erasure ──────────────────────────────────────────────────

  /**
   * Withdraws consent and erases the person behind the account.
   *
   * What is overwritten: name, email, phone, every saved address, the
   * password, and the sessions. What survives: orders, their totals and the
   * loyalty ledger — accounting records with a five-year retention that are
   * no longer attached to anyone identifiable once the row above is blanked.
   *
   * The order of the two halves is the whole design here, and it used to be the
   * wrong way round.
   *
   * Erasure spans three services: this one blanks the account, orders drops the
   * free text on orders and reviews, support replaces the messages. Only the
   * first is a local transaction; the other two are calls over the broker, so
   * they cannot be in it. Running them *after* the commit meant that if either
   * failed, the account was already marked `anonymizedAt` — and the next
   * attempt returned `{ success: true }` on the strength of that mark without
   * ever retrying them. The customer saw a 500, the account looked erased, and
   * the text they had actually asked to have removed stayed in the database
   * permanently, with nothing recording that it had been missed.
   *
   * So the other domains go first, and the local mark goes last. Both remote
   * calls are idempotent — they overwrite fields with constants — so a retry
   * after any failure simply repeats them. The mark is what is skipped on a
   * repeat, not the work.
   */
  async deleteAccount(userId: string, password: string, ip?: string): Promise<{ success: true }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Пользователь не найден');

    // The password, before anything is touched.
    //
    // This is the most destructive action the API offers and it is irreversible
    // by design — the name, the email, the phone and every address are
    // overwritten in place, so there is nothing to restore afterwards. It was
    // reachable with nothing but a session cookie: a borrowed laptop, an unlocked
    // phone, or an XSS payload that only had to issue one request. Asking for
    // something the holder of the session may not know is what makes the
    // difference between taking the device and taking the account.
    //
    // Skipped on a retry of an already-anonymised account: the stored hash is
    // random bytes by then, so no password could match, and the retry exists to
    // finish erasing data rather than to erase it again.
    if (!user.anonymizedAt && !(await bcrypt.compare(password, user.passwordHash))) {
      throw new ForbiddenException('Неверный пароль');
    }

    // Only on the first pass: an account already anonymised is already gone, and
    // it is not counted among the active administrators any more — so asking
    // again on a retry would refuse to finish the job it had started.
    if (!user.anonymizedAt && user.role === Role.ADMIN) {
      const admins = await this.prisma.user.count({
        where: { role: Role.ADMIN, isBlocked: false, anonymizedAt: null },
      });
      if (admins <= 1) throw new ForbiddenException('Нельзя удалить последнего администратора');
    }

    // Reviews and ticket messages carry text the customer wrote; each owning
    // service decides what to do with its own. First, and allowed to throw: a
    // failure here must leave the account intact so the retry does everything.
    await Promise.all([
      rpcSend(this.orders, ORDERS_PATTERNS.ANONYMIZE_USER, { userId }),
      rpcSend(this.support, SUPPORT_PATTERNS.ANONYMIZE_USER, { userId }),
    ]);

    // Everything below is idempotent-by-skipping: the row is already blank.
    if (user.anonymizedAt) return { success: true };

    const tombstone = `deleted-${user.id}@deleted.invalid`;

    await this.prisma.$transaction([
      this.prisma.address.deleteMany({ where: { userId } }),
      this.prisma.pushSubscription.deleteMany({ where: { userId } }),
      this.prisma.notification.deleteMany({ where: { userId } }),
      this.prisma.emailVerificationCode.deleteMany({ where: { userId } }),
      this.prisma.passwordResetToken.deleteMany({ where: { userId } }),
      this.prisma.favorite.deleteMany({ where: { userId } }),
      this.prisma.user.update({
        where: { id: userId },
        data: {
          email: tombstone,
          phone: null,
          firstName: 'Удалённый пользователь',
          lastName: null,
          // Not an empty string: a blank hash would make bcrypt.compare cheap
          // and the account technically reachable. Random bytes are reachable
          // by nobody, including us.
          passwordHash: randomBytes(48).toString('hex'),
          isEmailVerified: false,
          darkThemeEnabled: false,
          anonymizedAt: new Date(),
          consentVersion: null,
          consentAcceptedAt: null,
        },
      }),
      this.prisma.adminAuditLog.create({
        data: {
          action: AdminAction.ACCOUNT_ERASED,
          // Self-service erasure has no administrator behind it.
          actorId: null,
          targetType: 'user',
          targetId: userId,
          details: { reason: 'self-service' },
          ip,
        },
      }),
    ]);

    await this.tokens.revokeAllForUser(userId);
    await revokeSessionsBefore(
      this.cache,
      userId,
      parseTtlSeconds(this.config.get<string>('JWT_ACCESS_TTL')),
    );
    await this.cache.del(`cart:${userId}`);

    this.logger.log(`Erased personal data for account ${shortId(userId)}`);
    return { success: true };
  }
}
