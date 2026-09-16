import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
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
} from './auth.dto';

const errorsFor = <T extends object>(cls: new () => T, raw: unknown) =>
  validateSync(plainToInstance(cls, raw) as object);

const messagesFor = <T extends object>(cls: new () => T, raw: unknown) =>
  errorsFor(cls, raw).flatMap((error) => Object.values(error.constraints ?? {}));

const VALID_REGISTER = { email: 'guest@chicago.ru', password: 'Password1', firstName: 'Амина' };

/**
 * The gateway validates before anything reaches RabbitMQ, so these rules are
 * the app's actual input contract — the auth service mirrors them as defence
 * in depth.
 */
describe('RegisterBodyDto', () => {
  it('accepts the minimal registration', () => {
    expect(errorsFor(RegisterBodyDto, VALID_REGISTER)).toHaveLength(0);
  });

  it('accepts every optional field', () => {
    expect(
      errorsFor(RegisterBodyDto, {
        ...VALID_REGISTER,
        lastName: 'Магомедова',
        phone: '+79280000000',
        referralCode: 'FRIEND01',
      }),
    ).toHaveLength(0);
  });

  it.each([['guest'], ['guest@'], ['']])('rejects the address %p', (email) => {
    expect(errorsFor(RegisterBodyDto, { ...VALID_REGISTER, email }).length).toBeGreaterThan(0);
  });

  it.each([
    ['too short', 'Pass1'],
    ['no digit', 'Password'],
    ['no uppercase', 'password1'],
    ['no lowercase', 'PASSWORD1'],
    ['longer than bcrypt accepts', `Aa1${'x'.repeat(70)}`],
  ])('rejects a password that is %s', (_label, password) => {
    expect(errorsFor(RegisterBodyDto, { ...VALID_REGISTER, password }).length).toBeGreaterThan(0);
  });

  it('explains the password rule in Russian', () => {
    expect(messagesFor(RegisterBodyDto, { ...VALID_REGISTER, password: 'password' })).toEqual(
      expect.arrayContaining([expect.stringContaining('заглавные буквы и цифру')]),
    );
  });

  it.each([['89280000000'], ['+7928000000'], ['+7 928 000 00 00']])('rejects the phone %p', (phone) => {
    expect(errorsFor(RegisterBodyDto, { ...VALID_REGISTER, phone }).length).toBeGreaterThan(0);
  });

  it('bounds the names', () => {
    expect(errorsFor(RegisterBodyDto, { ...VALID_REGISTER, firstName: '' }).length).toBeGreaterThan(0);
    expect(errorsFor(RegisterBodyDto, { ...VALID_REGISTER, lastName: 'я'.repeat(51) }).length).toBeGreaterThan(0);
  });
});

describe('LoginBodyDto', () => {
  it('accepts any non-empty password so legacy accounts can still sign in', () => {
    expect(errorsFor(LoginBodyDto, { email: 'guest@chicago.ru', password: 'old' })).toHaveLength(0);
  });

  it('still requires a well-formed address', () => {
    expect(errorsFor(LoginBodyDto, { email: 'guest', password: 'x' }).length).toBeGreaterThan(0);
  });
});

describe('email verification DTOs', () => {
  it('requires exactly six characters of code', () => {
    expect(errorsFor(VerifyEmailBodyDto, { email: 'guest@chicago.ru', code: '123456' })).toHaveLength(0);
    expect(errorsFor(VerifyEmailBodyDto, { email: 'guest@chicago.ru', code: '12345' }).length).toBeGreaterThan(0);
    expect(errorsFor(VerifyEmailBodyDto, { email: 'guest@chicago.ru', code: '1234567' }).length).toBeGreaterThan(0);
  });

  it('needs only an address to resend', () => {
    expect(errorsFor(ResendVerificationBodyDto, { email: 'guest@chicago.ru' })).toHaveLength(0);
    expect(errorsFor(ResendVerificationBodyDto, { email: 'nope' }).length).toBeGreaterThan(0);
  });
});

describe('password reset DTOs', () => {
  it('asks only for the address up front', () => {
    expect(errorsFor(RequestPasswordResetBodyDto, { email: 'guest@chicago.ru' })).toHaveLength(0);
  });

  it('applies the full policy to the new password', () => {
    expect(errorsFor(ResetPasswordBodyDto, { token: 't', newPassword: 'NewPass1' })).toHaveLength(0);
    expect(errorsFor(ResetPasswordBodyDto, { token: 't', newPassword: 'weak' }).length).toBeGreaterThan(0);
    expect(errorsFor(ResetPasswordBodyDto, { newPassword: 'NewPass1' }).length).toBeGreaterThan(0);
  });
});

describe('UpdateProfileBodyDto', () => {
  it('accepts an empty patch', () => {
    expect(errorsFor(UpdateProfileBodyDto, {})).toHaveLength(0);
  });

  it.each([['ru'], ['en']])('accepts locale %s', (locale) => {
    expect(errorsFor(UpdateProfileBodyDto, { locale })).toHaveLength(0);
  });

  it.each([
    ['an unsupported locale', { locale: 'fr' }],
    ['a non-boolean theme flag', { darkThemeEnabled: 'yes' }],
    ['an over-long name', { firstName: 'я'.repeat(51) }],
  ])('rejects %s', (_label, raw) => {
    expect(errorsFor(UpdateProfileBodyDto, raw).length).toBeGreaterThan(0);
  });
});

describe('address DTOs', () => {
  const VALID = { title: 'Дом', street: 'пр. Расула Гамзатова', house: '45' };

  it('requires title, street and house', () => {
    expect(errorsFor(CreateAddressDto, VALID)).toHaveLength(0);
    expect(errorsFor(CreateAddressDto, { title: 'Дом' }).length).toBeGreaterThan(0);
  });

  it('accepts the full optional set including coordinates', () => {
    expect(
      errorsFor(CreateAddressDto, {
        ...VALID,
        city: 'Махачкала',
        apartment: '12',
        entrance: '2',
        floor: '4',
        comment: 'код домофона 45',
        lat: 42.97,
        lng: 47.5,
        isDefault: true,
      }),
    ).toHaveLength(0);
  });

  it.each([
    ['a non-numeric latitude', { lat: 'север' }],
    ['a non-boolean default flag', { isDefault: 'yes' }],
    ['an over-long comment', { comment: 'x'.repeat(501) }],
  ])('rejects %s', (_label, override) => {
    expect(errorsFor(CreateAddressDto, { ...VALID, ...override }).length).toBeGreaterThan(0);
  });

  it('keeps the same rules for an update', () => {
    expect(errorsFor(UpdateAddressDto, VALID)).toHaveLength(0);
    expect(errorsFor(UpdateAddressDto, {}).length).toBeGreaterThan(0);
  });
});
