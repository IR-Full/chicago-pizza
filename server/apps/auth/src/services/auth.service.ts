import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import { AdminAction, PrismaService, Role, User } from '@chicago-pizza/prisma';
import {
  AuditService,
  consentIsCurrent,
  paginate,
  parseTtlSeconds,
  PRIVACY_POLICY_VERSION,
  RedisCacheService,
  revokeSessionsBefore,
  RMQ_EVENTS,
} from '@chicago-pizza/common';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, randomInt } from 'crypto';
import { RegisterDto } from '../dto/register.dto';
import { LoginContextDto, LoginDto } from '../dto/login.dto';
import { ResendVerificationDto, VerifyEmailDto } from '../dto/verify-email.dto';
import { RequestPasswordResetDto, ResetPasswordDto } from '../dto/password-reset.dto';
import { UpdateProfileDto } from '../dto/update-profile.dto';
import { TokenService, TokenPair } from './token.service';

const VERIFICATION_CODE_TTL_MINUTES = 15;
const PASSWORD_RESET_TTL_MINUTES = 30;

/** Wrong codes tolerated before the outstanding codes are burned. */
const VERIFICATION_MAX_ATTEMPTS = 5;

/**
 * How much looser the whole-account failure budget is than the per-source one.
 * Ten sources getting it wrong five times each is an attack; one user on a
 * flaky phone is not.
 */
const ACCOUNT_LOCK_FACTOR = 10;

/**
 * A real bcrypt hash of a value nobody can present (it is not the hash of any
 * password we would accept), used to keep the "unknown account" login path as
 * slow as the known one. Generated once with 12 rounds.
 */
const DUMMY_PASSWORD_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.Nd7fOZZJ7rF0N2CqJ3OFPpr3rM8rk1K';

export interface PublicUser {
  id: string;
  email: string;
  phone: string | null;
  firstName: string;
  lastName: string | null;
  role: Role;
  isEmailVerified: boolean;
  isBlocked: boolean;
  loyaltyPoints: number;
  loyaltyLevel: string;
  referralCode: string;
  darkThemeEnabled: boolean;
  locale: string;
  /**
   * True when the customer has never accepted the personal-data policy, or
   * accepted a version older than the current text. The client uses it to ask
   * again rather than assuming an old agreement still covers a new document.
   */
  needsPrivacyConsent: boolean;
  createdAt: Date;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly tokens: TokenService,
    private readonly cache: RedisCacheService,
    private readonly audit: AuditService,
    @Inject('NOTIFICATIONS_SERVICE') private readonly notifications: ClientProxy,
  ) {}

  // ── Registration & verification ──────────────────────────────

  async register(dto: RegisterDto): Promise<{ status: 'verification_sent' }> {
    const email = dto.email.toLowerCase();

    // Hash before branching. Doing it only on the happy path made the
    // "address already taken" answer come back measurably sooner, which is
    // the same disclosure the uniform response below exists to prevent.
    const saltRounds = this.config.get<number>('BCRYPT_SALT_ROUNDS')!;
    const passwordHash = await bcrypt.hash(dto.password, saltRounds);

    const existingByEmail = await this.prisma.user.findUnique({ where: { email } });
    if (existingByEmail) {
      // Answering "this address is already registered" turns the form into a
      // membership oracle: anyone can test a list of addresses against it.
      // The owner of the address is told instead, by email, and the caller
      // gets the same response a fresh signup gets.
      this.notifications.emit(RMQ_EVENTS.REGISTRATION_ATTEMPTED, {
        userId: existingByEmail.id,
        email: existingByEmail.email,
        firstName: existingByEmail.firstName,
      });
      return { status: 'verification_sent' };
    }

    // The phone stays an explicit conflict. It is optional, it is not the
    // login identifier, and the uniform answer above has nowhere to go here:
    // the address typed in is a stranger's, so mailing it "you already have
    // an account" would be both a lie and a leak. A dead-end signup with no
    // explanation is the worse trade.
    if (dto.phone) {
      const existingByPhone = await this.prisma.user.findUnique({ where: { phone: dto.phone } });
      if (existingByPhone) throw new ConflictException('Этот номер телефона уже используется');
    }

    const referrer = dto.referralCode
      ? await this.prisma.user.findUnique({ where: { referralCode: dto.referralCode.toUpperCase() } })
      : null;

    const user = await this.prisma.user.create({
      data: {
        email,
        phone: dto.phone,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        referralCode: await this.generateReferralCode(),
        // Which text was agreed to, and when — a boolean would not survive
        // the first revision of the policy.
        consentVersion: PRIVACY_POLICY_VERSION,
        consentAcceptedAt: new Date(),
      },
    });

    if (referrer) {
      await this.prisma.referral.create({
        data: { referrerId: referrer.id, referredUserId: user.id },
      });
    }

    const code = await this.createEmailVerificationCode(user.id);
    this.notifications.emit(RMQ_EVENTS.EMAIL_VERIFICATION_REQUESTED, {
      userId: user.id,
      email: user.email,
      firstName: user.firstName,
      code,
    });
    this.notifications.emit(RMQ_EVENTS.USER_REGISTERED, { userId: user.id, email: user.email });

    return { status: 'verification_sent' };
  }

  async verifyEmail(dto: VerifyEmailDto): Promise<{ verified: boolean }> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (!user) throw new NotFoundException('Пользователь не найден');
    if (user.isEmailVerified) return { verified: true };

    // Six digits is a million codes, but the gateway's per-IP limit is the
    // only thing that was slowing a guesser down — and an attacker with a
    // pool of addresses does not feel it. The budget belongs to the account.
    const attemptsKey = `auth:verify:attempts:${user.id}`;
    const attempts = await this.cache.incrWithTtl(attemptsKey, VERIFICATION_CODE_TTL_MINUTES * 60);
    if (attempts > VERIFICATION_MAX_ATTEMPTS) {
      // Burning the outstanding codes means a guesser cannot simply wait out
      // the counter and resume against the same target.
      await this.prisma.emailVerificationCode.updateMany({
        where: { userId: user.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      throw new BadRequestException('Слишком много попыток. Запросите новый код.');
    }

    const codeHash = this.hash(dto.code);
    const record = await this.prisma.emailVerificationCode.findFirst({
      where: { userId: user.id, codeHash, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!record) throw new BadRequestException('Код подтверждения неверен или истёк');

    await this.prisma.$transaction([
      this.prisma.emailVerificationCode.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      }),
      this.prisma.user.update({ where: { id: user.id }, data: { isEmailVerified: true } }),
    ]);
    await this.cache.del(attemptsKey);

    return { verified: true };
  }

  async resendVerification(dto: ResendVerificationDto): Promise<{ sent: boolean }> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    // Do not leak which emails exist.
    if (!user || user.isEmailVerified) return { sent: true };

    const throttleKey = `auth:verify:resend:${user.id}`;
    const attempts = await this.cache.incrWithTtl(throttleKey, 60);
    if (attempts > 3) throw new BadRequestException('Слишком много запросов, попробуйте через минуту');

    const code = await this.createEmailVerificationCode(user.id);
    this.notifications.emit(RMQ_EVENTS.EMAIL_VERIFICATION_REQUESTED, {
      userId: user.id,
      email: user.email,
      firstName: user.firstName,
      code,
    });
    return { sent: true };
  }

  // ── Login / logout / refresh ─────────────────────────────────

  /**
   * Failed logins are counted twice: once for this (account, source) pair and
   * once for the account as a whole.
   *
   * Counting only per account, as this used to, made the lockout itself the
   * attack: five wrong passwords from anywhere locked the rightful owner out
   * for fifteen minutes, repeatable forever, for any address an attacker cared
   * to name. Counting only per IP would let a botnet grind one account from a
   * thousand addresses. The pair stops the ordinary attacker; the wide
   * account counter — deliberately an order of magnitude looser — still stops
   * the distributed case without being cheap enough to weaponise.
   */
  private loginLockKeys(email: string, ip?: string) {
    // Redis keys are readable by anyone with a shell on the box, and an email
    // address is personal data; the digest identifies the account without
    // storing it.
    const account = this.hash(email).slice(0, 32);
    return {
      pairKey: `auth:login:fail:${account}:${this.hash(ip ?? 'unknown').slice(0, 16)}`,
      accountKey: `auth:login:fail:${account}`,
    };
  }

  async login(dto: LoginDto, context: LoginContextDto = {}): Promise<{ user: PublicUser; tokens: TokenPair }> {
    const email = dto.email.toLowerCase();
    const maxAttempts = this.config.get<number>('LOGIN_MAX_ATTEMPTS')!;
    const lockoutMinutes = this.config.get<number>('LOGIN_LOCKOUT_MINUTES')!;
    const { pairKey, accountKey } = this.loginLockKeys(email, context.ip);

    const [pairFailures, accountFailures] = await Promise.all([
      this.cache.get<number>(pairKey),
      this.cache.get<number>(accountKey),
    ]);

    if ((pairFailures ?? 0) >= maxAttempts || (accountFailures ?? 0) >= maxAttempts * ACCOUNT_LOCK_FACTOR) {
      throw new UnauthorizedException(
        `Слишком много неудачных попыток. Попробуйте через ${lockoutMinutes} мин.`,
      );
    }

    const user = await this.prisma.user.findUnique({ where: { email } });
    // An unknown address must cost the same as a known one. Skipping the
    // comparison returned in microseconds instead of the ~100ms bcrypt takes,
    // which is a reliable oracle for "does this account exist".
    const passwordValid = user
      ? await bcrypt.compare(dto.password, user.passwordHash)
      : await this.burnPasswordComparison(dto.password);

    if (!user || !passwordValid) {
      const ttl = lockoutMinutes * 60;
      await Promise.all([
        this.cache.incrWithTtl(pairKey, ttl),
        this.cache.incrWithTtl(accountKey, ttl),
      ]);
      throw new UnauthorizedException('Неверный email или пароль');
    }

    if (user.isBlocked) throw new UnauthorizedException('Аккаунт заблокирован');

    await this.cache.del(pairKey, accountKey);
    const tokens = await this.tokens.issueTokenPair(user, context);
    return { user: this.toPublicUser(user), tokens };
  }

  /**
   * Spends the same time a real comparison would, against a fixed hash, and
   * always fails. Exists purely so the "no such user" path is not faster.
   */
  private async burnPasswordComparison(password: string): Promise<false> {
    await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
    return false;
  }

  async refresh(refreshToken: string, context: LoginContextDto = {}): Promise<{ tokens: TokenPair }> {
    const tokens = await this.tokens.rotate(refreshToken, context);
    return { tokens };
  }

  async logout(refreshToken: string): Promise<{ success: boolean }> {
    await this.tokens.revoke(refreshToken);
    return { success: true };
  }

  // ── Password reset ───────────────────────────────────────────

  async requestPasswordReset(dto: RequestPasswordResetDto): Promise<{ sent: boolean }> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (!user) return { sent: true }; // do not leak account existence

    const token = randomBytes(32).toString('hex');
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hash(token),
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000),
      },
    });

    this.notifications.emit(RMQ_EVENTS.PASSWORD_RESET_REQUESTED, {
      userId: user.id,
      email: user.email,
      firstName: user.firstName,
      token,
    });
    return { sent: true };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ success: boolean }> {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: this.hash(dto.token) },
    });
    if (!record || record.consumedAt || record.expiresAt < new Date()) {
      throw new BadRequestException('Ссылка восстановления недействительна или истекла');
    }

    const saltRounds = this.config.get<number>('BCRYPT_SALT_ROUNDS')!;
    const passwordHash = await bcrypt.hash(dto.newPassword, saltRounds);

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
      this.prisma.passwordResetToken.update({ where: { id: record.id }, data: { consumedAt: new Date() } }),
    ]);
    // A password change invalidates every existing session — including the
    // access tokens already in the wild, not just the refresh tokens.
    await this.tokens.revokeAllForUser(record.userId);
    await this.revokeLiveSessions(record.userId);

    return { success: true };
  }

  // ── Profile ──────────────────────────────────────────────────

  async getProfile(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Пользователь не найден');
    return this.toPublicUser(user);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<PublicUser> {
    const user = await this.prisma.user.update({ where: { id: userId }, data: dto });
    return this.toPublicUser(user);
  }

  // ── Admin ────────────────────────────────────────────────────

  async adminListUsers(params: { page: number; limit: number; search?: string }) {
    const where = params.search
      ? {
          OR: [
            { email: { contains: params.search, mode: 'insensitive' as const } },
            { firstName: { contains: params.search, mode: 'insensitive' as const } },
            { phone: { contains: params.search } },
          ],
        }
      : {};

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    return paginate(items.map((u) => this.toPublicUser(u)), total, params);
  }

  async adminSetRole(userId: string, role: Role, actorId: string): Promise<PublicUser> {
    // Losing your own admin rights by a misclick leaves nobody able to hand
    // them back — the only way out would be an UPDATE in the database.
    if (userId === actorId) throw new BadRequestException('Нельзя изменить собственную роль');

    const target = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!target) throw new NotFoundException('Пользователь не найден');

    if (target.role === Role.ADMIN && role !== Role.ADMIN) {
      const admins = await this.prisma.user.count({ where: { role: Role.ADMIN, isBlocked: false } });
      if (admins <= 1) throw new BadRequestException('Нельзя снять роль с последнего администратора');
    }

    const user = await this.prisma.user.update({ where: { id: userId }, data: { role } });
    // Handing someone the keys to the shop is exactly the kind of action that
    // needs an answer months later.
    await this.audit.record({
      action: AdminAction.USER_ROLE_CHANGED,
      actorId,
      targetType: 'user',
      targetId: userId,
      details: { from: target.role, to: role },
    });
    // Role changes must not stay latent in already-issued access tokens.
    await this.tokens.revokeAllForUser(userId);
    await this.revokeLiveSessions(userId);
    return this.toPublicUser(user);
  }

  async adminSetBlocked(userId: string, isBlocked: boolean, actorId: string): Promise<PublicUser> {
    if (userId === actorId) throw new BadRequestException('Нельзя заблокировать собственный аккаунт');

    const target = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!target) throw new NotFoundException('Пользователь не найден');

    if (isBlocked && target.role === Role.ADMIN) {
      const admins = await this.prisma.user.count({ where: { role: Role.ADMIN, isBlocked: false } });
      if (admins <= 1) throw new BadRequestException('Нельзя заблокировать последнего администратора');
    }

    const user = await this.prisma.user.update({ where: { id: userId }, data: { isBlocked } });
    await this.audit.record({
      action: isBlocked ? AdminAction.USER_BLOCKED : AdminAction.USER_UNBLOCKED,
      actorId,
      targetType: 'user',
      targetId: userId,
    });
    if (isBlocked) {
      await this.tokens.revokeAllForUser(userId);
      await this.revokeLiveSessions(userId);
    }
    return this.toPublicUser(user);
  }

  // ── Helpers ──────────────────────────────────────────────────

  /**
   * Publishes "every token issued before now is void" for this user. The
   * gateway checks it on each request, so a block or a role change takes
   * effect immediately instead of after the access token expires.
   */
  private async revokeLiveSessions(userId: string): Promise<void> {
    const ttlSeconds = parseTtlSeconds(this.config.get<string>('JWT_ACCESS_TTL'));
    await revokeSessionsBefore(this.cache, userId, ttlSeconds);
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private async createEmailVerificationCode(userId: string): Promise<string> {
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.prisma.emailVerificationCode.create({
      data: {
        userId,
        codeHash: this.hash(code),
        expiresAt: new Date(Date.now() + VERIFICATION_CODE_TTL_MINUTES * 60 * 1000),
      },
    });
    return code;
  }

  private async generateReferralCode(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomBytes(4).toString('hex').toUpperCase();
      const taken = await this.prisma.user.findUnique({ where: { referralCode: code } });
      if (!taken) return code;
    }
    throw new Error('Не удалось сгенерировать уникальный реферальный код');
  }

  private toPublicUser(user: User): PublicUser {
    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      isEmailVerified: user.isEmailVerified,
      isBlocked: user.isBlocked,
      loyaltyPoints: user.loyaltyPoints,
      loyaltyLevel: user.loyaltyLevel,
      referralCode: user.referralCode,
      darkThemeEnabled: user.darkThemeEnabled,
      locale: user.locale,
      needsPrivacyConsent: !consentIsCurrent(user.consentVersion),
      createdAt: user.createdAt,
    };
  }
}
