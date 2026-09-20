import { Equals, IsBoolean, IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message: 'Password must contain upper and lower case letters and a digit',
  })
  password!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  firstName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  lastName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+7\d{10}$/, { message: 'Phone must be in format +7XXXXXXXXXX' })
  phone?: string;

  @IsOptional()
  @IsString()
  referralCode?: string;

  /**
   * Consent to the processing of personal data (152-ФЗ). Required, and
   * required to be `true`: the service stores the address, the phone and the
   * delivery address of a named person, which is processing that needs an
   * explicit, recorded agreement — not a pre-ticked box in a form.
   */
  @IsBoolean()
  @Equals(true, { message: 'Необходимо согласие на обработку персональных данных' })
  acceptPrivacyPolicy!: boolean;
}
