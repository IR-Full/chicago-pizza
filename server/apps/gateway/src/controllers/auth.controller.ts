import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientProxy } from '@nestjs/microservices';
import { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AUTH_PATTERNS, CurrentUser, JwtPayload, Public, rpcSend } from '@chicago-pizza/common';
import { clearAuthCookies, hashRefreshToken, REFRESH_TOKEN_COOKIE, setAuthCookies } from '../common/cookies';
import {
  CreateAddressDto,
  LoginBodyDto,
  RegisterBodyDto,
  RequestPasswordResetBodyDto,
  ResendVerificationBodyDto,
  ResetPasswordBodyDto,
  UpdateAddressDto,
  UpdateProfileBodyDto,
  VerifyEmailBodyDto,
} from '../dto/auth.dto';

/**
 * `req.cookies` is typed `any` by Express, so every read of it silently
 * widened whatever it produced. One typed accessor keeps that at the edge.
 */
function readRefreshCookie(req: Request): string | undefined {
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  return cookies?.[REFRESH_TOKEN_COOKIE];
}

interface TokenPairResponse {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(@Inject('AUTH_SERVICE') private readonly auth: ClientProxy) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  @ApiOperation({ summary: 'Регистрация нового пользователя' })
  register(@Body() dto: RegisterBodyDto) {
    return rpcSend(this.auth, AUTH_PATTERNS.REGISTER, dto);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @ApiOperation({ summary: 'Вход по email и паролю' })
  async login(@Body() dto: LoginBodyDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await rpcSend<{ user: unknown; tokens: TokenPairResponse }>(this.auth, AUTH_PATTERNS.LOGIN, {
      ...dto,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    setAuthCookies(res, result.tokens);
    return { user: result.user };
  }

  @Public()
  @Post('refresh')
  @ApiOperation({ summary: 'Обновление пары токенов (ротация refresh-токена)' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE];
    if (!refreshToken) throw new UnauthorizedException('Refresh token missing');

    const result = await rpcSend<{ tokens: TokenPairResponse }>(this.auth, AUTH_PATTERNS.REFRESH, {
      refreshToken,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    setAuthCookies(res, result.tokens);
    return { success: true };
  }

  @Public()
  @Post('logout')
  @ApiOperation({ summary: 'Выход и отзыв refresh-токена' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE];
    if (refreshToken) await rpcSend(this.auth, AUTH_PATTERNS.LOGOUT, { refreshToken });
    clearAuthCookies(res);
    return { success: true };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('verify-email')
  @ApiOperation({ summary: 'Подтверждение email по 6-значному коду' })
  verifyEmail(@Body() dto: VerifyEmailBodyDto) {
    return rpcSend(this.auth, AUTH_PATTERNS.VERIFY_EMAIL, dto);
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('resend-verification')
  resendVerification(@Body() dto: ResendVerificationBodyDto) {
    return rpcSend(this.auth, AUTH_PATTERNS.RESEND_VERIFICATION, dto);
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('forgot-password')
  requestPasswordReset(@Body() dto: RequestPasswordResetBodyDto) {
    return rpcSend(this.auth, AUTH_PATTERNS.REQUEST_PASSWORD_RESET, dto);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordBodyDto) {
    return rpcSend(this.auth, AUTH_PATTERNS.RESET_PASSWORD, dto);
  }

  // ── Profile ──────────────────────────────────────────────────

  @ApiCookieAuth()
  @Get('me')
  @ApiOperation({ summary: 'Текущий пользователь' })
  getProfile(@CurrentUser() user: JwtPayload) {
    return rpcSend(this.auth, AUTH_PATTERNS.GET_PROFILE, { userId: user.sub });
  }

  @ApiCookieAuth()
  @Patch('me')
  updateProfile(@CurrentUser() user: JwtPayload, @Body() dto: UpdateProfileBodyDto) {
    return rpcSend(this.auth, AUTH_PATTERNS.UPDATE_PROFILE, { userId: user.sub, dto });
  }

  // ── Personal data (152-ФЗ) ───────────────────────────────────

  /**
   * The sessions the customer currently has open. `ip` and `userAgent` were
   * being recorded on every sign-in and shown to nobody; this is what they
   * were collected for — spotting a login you do not recognise.
   */
  @ApiCookieAuth()
  @Get('sessions')
  @ApiOperation({ summary: 'Активные сессии аккаунта' })
  listSessions(@CurrentUser() user: JwtPayload, @Req() req: Request) {
    return rpcSend(this.auth, AUTH_PATTERNS.LIST_SESSIONS, {
      userId: user.sub,
      // Hashed here so the caller's own session can be marked without the
      // raw token ever leaving the gateway.
      currentTokenHash: hashRefreshToken(readRefreshCookie(req)),
    });
  }

  @ApiCookieAuth()
  @Delete('sessions/:id')
  @ApiOperation({ summary: 'Завершить чужую сессию' })
  revokeSession(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) sessionId: string,
    @Req() req: Request,
  ) {
    return rpcSend(this.auth, AUTH_PATTERNS.REVOKE_SESSION, {
      userId: user.sub,
      sessionId,
      currentTokenHash: hashRefreshToken(readRefreshCookie(req)),
    });
  }

  @ApiCookieAuth()
  @Get('me/export')
  @ApiOperation({ summary: 'Выгрузка всех данных аккаунта (право на копию)' })
  async exportData(@CurrentUser() user: JwtPayload, @Res({ passthrough: true }) res: Response) {
    const data = await rpcSend(this.auth, AUTH_PATTERNS.EXPORT_DATA, { userId: user.sub });
    // A download, not a page: the browser saves it instead of rendering a
    // wall of JSON, and the copy is something the customer keeps.
    res.setHeader('Content-Disposition', 'attachment; filename="chicago-pizza-data.json"');
    return data;
  }

  /**
   * Withdrawal of consent, which under 152-ФЗ has to be as available as
   * giving it was. Orders survive as anonymous accounting rows; everything
   * that names the person is overwritten.
   */
  @ApiCookieAuth()
  @Delete('me')
  @ApiOperation({ summary: 'Удалить аккаунт и стереть персональные данные' })
  async deleteAccount(
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await rpcSend(this.auth, AUTH_PATTERNS.DELETE_ACCOUNT, { userId: user.sub, ip: req.ip });
    clearAuthCookies(res);
    return result;
  }

  // ── Addresses ────────────────────────────────────────────────

  @ApiCookieAuth()
  @Get('addresses')
  listAddresses(@CurrentUser() user: JwtPayload) {
    return rpcSend(this.auth, AUTH_PATTERNS.LIST_ADDRESSES, { userId: user.sub });
  }

  @ApiCookieAuth()
  @Post('addresses')
  createAddress(@CurrentUser() user: JwtPayload, @Body() dto: CreateAddressDto) {
    return rpcSend(this.auth, AUTH_PATTERNS.CREATE_ADDRESS, { userId: user.sub, dto });
  }

  @ApiCookieAuth()
  @Patch('addresses/:id')
  updateAddress(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) addressId: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return rpcSend(this.auth, AUTH_PATTERNS.UPDATE_ADDRESS, { userId: user.sub, addressId, dto });
  }

  @ApiCookieAuth()
  @Delete('addresses/:id')
  deleteAddress(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) addressId: string) {
    return rpcSend(this.auth, AUTH_PATTERNS.DELETE_ADDRESS, { userId: user.sub, addressId });
  }
}
