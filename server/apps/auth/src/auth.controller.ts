import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { AUTH_PATTERNS } from '@chicago-pizza/common';
import { Role } from '@chicago-pizza/prisma';
import { AuthService } from './services/auth.service';
import { AddressService } from './services/address.service';
import { RegisterDto } from './dto/register.dto';
import { LoginContextDto, LoginDto } from './dto/login.dto';
import { ResendVerificationDto, VerifyEmailDto } from './dto/verify-email.dto';
import { RequestPasswordResetDto, ResetPasswordDto } from './dto/password-reset.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CreateAddressDto, UpdateAddressDto } from './dto/address.dto';

@Controller()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly addresses: AddressService,
  ) {}

  @MessagePattern(AUTH_PATTERNS.REGISTER)
  register(@Payload() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @MessagePattern(AUTH_PATTERNS.LOGIN)
  login(@Payload() payload: LoginDto & LoginContextDto) {
    const { ip, userAgent, ...dto } = payload;
    return this.auth.login(dto, { ip, userAgent });
  }

  @MessagePattern(AUTH_PATTERNS.REFRESH)
  refresh(@Payload() payload: { refreshToken: string } & LoginContextDto) {
    return this.auth.refresh(payload.refreshToken, { ip: payload.ip, userAgent: payload.userAgent });
  }

  @MessagePattern(AUTH_PATTERNS.LOGOUT)
  logout(@Payload() payload: { refreshToken: string }) {
    return this.auth.logout(payload.refreshToken);
  }

  @MessagePattern(AUTH_PATTERNS.VERIFY_EMAIL)
  verifyEmail(@Payload() dto: VerifyEmailDto) {
    return this.auth.verifyEmail(dto);
  }

  @MessagePattern(AUTH_PATTERNS.RESEND_VERIFICATION)
  resendVerification(@Payload() dto: ResendVerificationDto) {
    return this.auth.resendVerification(dto);
  }

  @MessagePattern(AUTH_PATTERNS.REQUEST_PASSWORD_RESET)
  requestPasswordReset(@Payload() dto: RequestPasswordResetDto) {
    return this.auth.requestPasswordReset(dto);
  }

  @MessagePattern(AUTH_PATTERNS.RESET_PASSWORD)
  resetPassword(@Payload() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto);
  }

  @MessagePattern(AUTH_PATTERNS.GET_PROFILE)
  getProfile(@Payload() payload: { userId: string }) {
    return this.auth.getProfile(payload.userId);
  }

  @MessagePattern(AUTH_PATTERNS.UPDATE_PROFILE)
  updateProfile(@Payload() payload: { userId: string; dto: UpdateProfileDto }) {
    return this.auth.updateProfile(payload.userId, payload.dto);
  }

  @MessagePattern(AUTH_PATTERNS.GET_USER_BY_ID)
  getUserById(@Payload() payload: { userId: string }) {
    return this.auth.getProfile(payload.userId);
  }

  // ── Addresses ────────────────────────────────────────────────

  @MessagePattern(AUTH_PATTERNS.LIST_ADDRESSES)
  listAddresses(@Payload() payload: { userId: string }) {
    return this.addresses.list(payload.userId);
  }

  @MessagePattern(AUTH_PATTERNS.CREATE_ADDRESS)
  createAddress(@Payload() payload: { userId: string; dto: CreateAddressDto }) {
    return this.addresses.create(payload.userId, payload.dto);
  }

  @MessagePattern(AUTH_PATTERNS.UPDATE_ADDRESS)
  updateAddress(@Payload() payload: { userId: string; addressId: string; dto: UpdateAddressDto }) {
    return this.addresses.update(payload.userId, payload.addressId, payload.dto);
  }

  @MessagePattern(AUTH_PATTERNS.DELETE_ADDRESS)
  deleteAddress(@Payload() payload: { userId: string; addressId: string }) {
    return this.addresses.remove(payload.userId, payload.addressId);
  }

  // ── Admin ────────────────────────────────────────────────────

  @MessagePattern(AUTH_PATTERNS.ADMIN_LIST_USERS)
  adminListUsers(@Payload() payload: { page: number; limit: number; search?: string }) {
    return this.auth.adminListUsers(payload);
  }

  @MessagePattern(AUTH_PATTERNS.ADMIN_SET_ROLE)
  adminSetRole(@Payload() payload: { userId: string; role: Role }) {
    return this.auth.adminSetRole(payload.userId, payload.role);
  }

  @MessagePattern(AUTH_PATTERNS.ADMIN_SET_BLOCKED)
  adminSetBlocked(@Payload() payload: { userId: string; isBlocked: boolean }) {
    return this.auth.adminSetBlocked(payload.userId, payload.isBlocked);
  }
}
