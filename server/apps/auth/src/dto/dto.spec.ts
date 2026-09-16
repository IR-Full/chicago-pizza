import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { RegisterDto } from './register.dto';
import { LoginDto } from './login.dto';
import { ResendVerificationDto, VerifyEmailDto } from './verify-email.dto';
import { RequestPasswordResetDto, ResetPasswordDto } from './password-reset.dto';
import { UpdateProfileDto } from './update-profile.dto';
import { CreateAddressDto, UpdateAddressDto } from './address.dto';

const errorsFor = <T extends object>(cls: new () => T, raw: unknown) =>
  validateSync(plainToInstance(cls, raw) as object);

const messagesFor = <T extends object>(cls: new () => T, raw: unknown) =>
  errorsFor(cls, raw).flatMap((error) => Object.values(error.constraints ?? {}));

const VALID_REGISTER = {
  email: 'guest@chicago.ru',
  password: 'Password1',
  firstName: 'Амина',
};

describe('RegisterDto', () => {
  it('accepts the minimal valid registration', () => {
    expect(errorsFor(RegisterDto, VALID_REGISTER)).toHaveLength(0);
  });

  it('accepts every optional field filled in', () => {
    const errors = errorsFor(RegisterDto, {
      ...VALID_REGISTER,
      lastName: 'Магомедова',
      phone: '+79280000000',
      referralCode: 'FRIEND01',
    });

    expect(errors).toHaveLength(0);
  });

  it.each([['not-an-email'], ['guest@'], ['@chicago.ru'], ['']])('rejects the address %p', (email) => {
    expect(errorsFor(RegisterDto, { ...VALID_REGISTER, email }).length).toBeGreaterThan(0);
  });

  it.each([
    ['too short', 'Pass1'],
    ['no digit', 'Password'],
    ['no uppercase', 'password1'],
    ['no lowercase', 'PASSWORD1'],
  ])('rejects a password that is %s', (_label, password) => {
    expect(errorsFor(RegisterDto, { ...VALID_REGISTER, password }).length).toBeGreaterThan(0);
  });

  it('explains the password rule in the message', () => {
    expect(messagesFor(RegisterDto, { ...VALID_REGISTER, password: 'password' })).toEqual(
      expect.arrayContaining([expect.stringContaining('upper and lower case')]),
    );
  });

  it('caps the password at bcrypt’s 72-byte limit', () => {
    const errors = errorsFor(RegisterDto, { ...VALID_REGISTER, password: `Aa1${'x'.repeat(70)}` });

    expect(errors.length).toBeGreaterThan(0);
  });

  it('requires a first name of at most fifty characters', () => {
    expect(errorsFor(RegisterDto, { ...VALID_REGISTER, firstName: '' }).length).toBeGreaterThan(0);
    expect(errorsFor(RegisterDto, { ...VALID_REGISTER, firstName: 'а'.repeat(51) }).length).toBeGreaterThan(0);
    expect(errorsFor(RegisterDto, { ...VALID_REGISTER, firstName: 'а'.repeat(50) })).toHaveLength(0);
  });

  it.each([['89280000000'], ['+7928000000'], ['+792800000001'], ['+7 928 000 00 00']])(
    'rejects the phone %p',
    (phone) => {
      expect(errorsFor(RegisterDto, { ...VALID_REGISTER, phone }).length).toBeGreaterThan(0);
    },
  );

  it('accepts the canonical Russian phone format', () => {
    expect(errorsFor(RegisterDto, { ...VALID_REGISTER, phone: '+79280000000' })).toHaveLength(0);
  });
});

describe('LoginDto', () => {
  it('accepts an email and any non-empty password', () => {
    expect(errorsFor(LoginDto, { email: 'guest@chicago.ru', password: 'x' })).toHaveLength(0);
  });

  it.each([
    ['a malformed email', { email: 'guest', password: 'x' }],
    ['a missing password', { email: 'guest@chicago.ru' }],
    ['a numeric password', { email: 'guest@chicago.ru', password: 12345 }],
  ])('rejects %s', (_label, raw) => {
    expect(errorsFor(LoginDto, raw).length).toBeGreaterThan(0);
  });

  it('does not impose the registration password policy on login', () => {
    // Accounts created before the policy must still be able to sign in.
    expect(errorsFor(LoginDto, { email: 'guest@chicago.ru', password: 'old' })).toHaveLength(0);
  });
});

describe('VerifyEmailDto', () => {
  it('accepts a six-digit code', () => {
    expect(errorsFor(VerifyEmailDto, { email: 'guest@chicago.ru', code: '123456' })).toHaveLength(0);
  });

  it.each([['12345'], ['1234567'], ['']])('rejects the code %p', (code) => {
    expect(errorsFor(VerifyEmailDto, { email: 'guest@chicago.ru', code }).length).toBeGreaterThan(0);
  });

  it('needs only the address to resend', () => {
    expect(errorsFor(ResendVerificationDto, { email: 'guest@chicago.ru' })).toHaveLength(0);
    expect(errorsFor(ResendVerificationDto, {}).length).toBeGreaterThan(0);
  });
});

describe('password reset DTOs', () => {
  it('asks only for the address when requesting a reset', () => {
    expect(errorsFor(RequestPasswordResetDto, { email: 'guest@chicago.ru' })).toHaveLength(0);
    expect(errorsFor(RequestPasswordResetDto, { email: 'nope' }).length).toBeGreaterThan(0);
  });

  it('applies the full password policy to the new password', () => {
    expect(errorsFor(ResetPasswordDto, { token: 't', newPassword: 'NewPass1' })).toHaveLength(0);
    expect(errorsFor(ResetPasswordDto, { token: 't', newPassword: 'weak' }).length).toBeGreaterThan(0);
  });

  it('requires the token', () => {
    expect(errorsFor(ResetPasswordDto, { newPassword: 'NewPass1' }).length).toBeGreaterThan(0);
  });
});

describe('UpdateProfileDto', () => {
  it('accepts an empty patch', () => {
    expect(errorsFor(UpdateProfileDto, {})).toHaveLength(0);
  });

  it('accepts the supported locales', () => {
    expect(errorsFor(UpdateProfileDto, { locale: 'ru' })).toHaveLength(0);
    expect(errorsFor(UpdateProfileDto, { locale: 'en' })).toHaveLength(0);
  });

  it.each([
    ['an unsupported locale', { locale: 'fr' }],
    ['a non-boolean theme flag', { darkThemeEnabled: 'yes' }],
    ['an over-long name', { firstName: 'а'.repeat(51) }],
  ])('rejects %s', (_label, raw) => {
    expect(errorsFor(UpdateProfileDto, raw).length).toBeGreaterThan(0);
  });
});

describe('address DTOs', () => {
  const VALID_ADDRESS = { title: 'Дом', street: 'пр. Расула Гамзатова', house: '45' };

  it('requires a title, street and house number', () => {
    expect(errorsFor(CreateAddressDto, VALID_ADDRESS)).toHaveLength(0);
    expect(errorsFor(CreateAddressDto, { title: 'Дом' }).length).toBeGreaterThan(0);
  });

  it('accepts the full optional set', () => {
    const errors = errorsFor(CreateAddressDto, {
      ...VALID_ADDRESS,
      city: 'Махачкала',
      apartment: '12',
      entrance: '2',
      floor: '4',
      comment: 'код домофона 45',
      lat: 42.97,
      lng: 47.5,
      isDefault: true,
    });

    expect(errors).toHaveLength(0);
  });

  it.each([
    ['a non-numeric latitude', { lat: 'север' }],
    ['a non-boolean default flag', { isDefault: 'yes' }],
    ['an over-long comment', { comment: 'x'.repeat(501) }],
    ['an over-long street', { street: 'x'.repeat(201) }],
  ])('rejects %s', (_label, override) => {
    expect(errorsFor(CreateAddressDto, { ...VALID_ADDRESS, ...override }).length).toBeGreaterThan(0);
  });

  it('keeps the same rules when updating', () => {
    expect(errorsFor(UpdateAddressDto, VALID_ADDRESS)).toHaveLength(0);
    expect(errorsFor(UpdateAddressDto, {}).length).toBeGreaterThan(0);
  });
});
