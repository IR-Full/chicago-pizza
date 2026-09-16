import { IsEmail, IsString } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;
}

export class LoginContextDto {
  ip?: string;
  userAgent?: string;
}
