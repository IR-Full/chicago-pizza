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
import { PrismaService, Role, User } from '@chicago-pizza/prisma';
import { RedisCacheService, RMQ_EVENTS } from '@chicago-pizza/common';
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
    @Inject('NOTIFICATIONS_SERVICE') private readonly notifications: ClientProxy,
  ) {}

  // ── Registration & verification ──────────────────────────────

  async register(dto: RegisterDto): Promise<{ user: PublicUser }> {
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email: dto.email.toLowerCase() }, ...(dto.phone ? [{ phone: dto.phone }] : [])] },
    });
    if (existing) throw new ConflictException('User with this email or phone already exists');

    const saltRounds = this.config.get<number>('BCRYPT_SALT_ROUNDS')!;
    const passwordHash = await bcrypt.hash(dto.password, saltRounds);

    const referrer = dto.referralCode
      ? await this.prisma.user.findUnique({ where: { referralCode: dto.referralCode.toUpperCase() } })
      : null;

    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        phone: dto.phone,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        referralCode: await this.generateReferralCode(),
        referredById: referrer?.id ?? null,
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

    return { user: this.toPublicUser(user) };
  }

  async verifyEmail(dto: VerifyEmailDto): Promise<{ verified: boolean }> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (!user) throw new NotFoundException('User not found');
    if (user.isEmailVerified) return { verified: true };

    const codeHash = this.hash(dto.code);
    const record = await this.prisma.emailVerificationCode.findFirst({
      where: { userId: user.id, codeHash, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!record) throw new BadRequestException('Invalid or expired verification code');

    await this.prisma.$transaction([
      this.prisma.emailVerificationCode.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      }),
      this.prisma.user.update({ where: { id: user.id }, data: { isEmailVerified: true } }),
    ]);

    return { verified: true };
  }

  async resendVerification(dto: ResendVerificationDto): Promise<{ sent: boolean }> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    // Do not leak which emails exist.
    if (!user || user.isEmailVerified) return { sent: true };

    const throttleKey = `auth:verify:resend:${user.id}`;
    const attempts = await this.cache.incrWithTtl(throttleKey, 60);
    if (attempts > 3) throw new BadRequestException('Too many requests, try again in a minute');

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

  async login(dto: LoginDto, context: LoginContextDto = {}): Promise<{ user: PublicUser; tokens: TokenPair }> {
    const email = dto.email.toLowerCase();
    const lockKey = `auth:login:lock:${email}`;
    const maxAttempts = this.config.get<number>('LOGIN_MAX_ATTEMPTS')!;
    const lockoutMinutes = this.config.get<number>('LOGIN_LOCKOUT_MINUTES')!;

    const attempts = (await this.cache.get<number>(lockKey)) ?? 0;
    if (attempts >= maxAttempts) {
      throw new UnauthorizedException(`Too many failed attempts. Try again in ${lockoutMinutes} minutes.`);
    }

    const user = await this.prisma.user.findUnique({ where: { email } });
    const passwordValid = user ? await bcrypt.compare(dto.password, user.passwordHash) : false;

    if (!user || !passwordValid) {
      // Count failures per email so brute force cannot enumerate passwords.
      await this.cache.incrWithTtl(lockKey, lockoutMinutes * 60);
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.isBlocked) throw new UnauthorizedException('Account is blocked');

    await this.cache.del(lockKey);
    const tokens = await this.tokens.issueTokenPair(user, context);
    return { user: this.toPublicUser(user), tokens };
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
      throw new BadRequestException('Invalid or expired reset token');
    }

    const saltRounds = this.config.get<number>('BCRYPT_SALT_ROUNDS')!;
    const passwordHash = await bcrypt.hash(dto.newPassword, saltRounds);

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
      this.prisma.passwordResetToken.update({ where: { id: record.id }, data: { consumedAt: new Date() } }),
    ]);
    // A password change invalidates every existing session.
    await this.tokens.revokeAllForUser(record.userId);

    return { success: true };
  }

  // ── Profile ──────────────────────────────────────────────────

  async getProfile(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
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

    return {
      items: items.map((u) => this.toPublicUser(u)),
      total,
      page: params.page,
      limit: params.limit,
      totalPages: Math.ceil(total / params.limit),
    };
  }

  async adminSetRole(userId: string, role: Role): Promise<PublicUser> {
    const user = await this.prisma.user.update({ where: { id: userId }, data: { role } });
    // Role changes must not stay latent in already-issued access tokens.
    await this.tokens.revokeAllForUser(userId);
    return this.toPublicUser(user);
  }

  async adminSetBlocked(userId: string, isBlocked: boolean): Promise<PublicUser> {
    const user = await this.prisma.user.update({ where: { id: userId }, data: { isBlocked } });
    if (isBlocked) await this.tokens.revokeAllForUser(userId);
    return this.toPublicUser(user);
  }

  // ── Helpers ──────────────────────────────────────────────────

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
    throw new Error('Failed to generate a unique referral code');
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
      createdAt: user.createdAt,
    };
  }
}
