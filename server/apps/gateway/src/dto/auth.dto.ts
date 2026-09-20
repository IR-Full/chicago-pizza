import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Equals,
  IsBoolean,
  IsEmail,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterBodyDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Passw0rd!', minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message: 'Пароль должен содержать строчные и заглавные буквы и цифру',
  })
  password!: string;

  @ApiProperty({ example: 'Иван' })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  firstName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  lastName?: string;

  @ApiPropertyOptional({ example: '+79280000000' })
  @IsOptional()
  @IsString()
  @Matches(/^\+7\d{10}$/, { message: 'Телефон должен быть в формате +7XXXXXXXXXX' })
  phone?: string;

  @ApiPropertyOptional({ description: 'Реферальный код пригласившего' })
  @IsOptional()
  @IsString()
  referralCode?: string;

  /**
   * Consent to the processing of personal data (152-ФЗ). The service stores a
   * named person's address, phone and delivery address; that is processing
   * which needs an explicit, recorded agreement, so the field is required and
   * must be `true` — a missing box is a rejected signup, not a default.
   */
  @ApiProperty({ description: 'Согласие на обработку персональных данных' })
  @IsBoolean()
  @Equals(true, { message: 'Необходимо согласие на обработку персональных данных' })
  acceptPrivacyPolicy!: boolean;
}

export class LoginBodyDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  password!: string;
}

export class VerifyEmailBodyDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @Length(6, 6)
  code!: string;
}

export class ResendVerificationBodyDto {
  @ApiProperty()
  @IsEmail()
  email!: string;
}

export class RequestPasswordResetBodyDto {
  @ApiProperty()
  @IsEmail()
  email!: string;
}

export class ResetPasswordBodyDto {
  @ApiProperty()
  @IsString()
  token!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message: 'Пароль должен содержать строчные и заглавные буквы и цифру',
  })
  newPassword!: string;
}

export class UpdateProfileBodyDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  lastName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  darkThemeEnabled?: boolean;

  @ApiPropertyOptional({ enum: ['ru', 'en'] })
  @IsOptional()
  @IsIn(['ru', 'en'])
  locale?: string;
}

export class CreateAddressDto {
  @ApiProperty({ example: 'Дом' })
  @IsString()
  @MaxLength(100)
  title!: string;

  @ApiPropertyOptional({ default: 'Махачкала' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiProperty({ example: 'пр. Имама Шамиля' })
  @IsString()
  @MaxLength(200)
  street!: string;

  @ApiProperty({ example: '48' })
  @IsString()
  @MaxLength(20)
  house!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  apartment?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  entrance?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  floor?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;

  @ApiPropertyOptional({ description: 'Широта (из карты 2GIS)' })
  @IsOptional()
  @IsNumber()
  lat?: number;

  @ApiPropertyOptional({ description: 'Долгота (из карты 2GIS)' })
  @IsOptional()
  @IsNumber()
  lng?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateAddressDto extends CreateAddressDto {}
