import { describe, expect, it } from 'vitest';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from './schemas';

/** The error strings are i18n keys, so the message is part of the contract. */
const errorFor = (schema: { safeParse: (v: unknown) => { success: boolean; error?: { issues: { message: string; path: (string | number)[] }[] } } }, value: unknown) => {
  const result = schema.safeParse(value);
  return result.success ? [] : result.error!.issues.map((issue) => `${issue.path.join('.')}:${issue.message}`);
};

describe('loginSchema', () => {
  it('accepts an email and a password', () => {
    expect(loginSchema.safeParse({ email: 'guest@chicago.ru', password: 'x' }).success).toBe(true);
  });

  it('reports a missing email as "required"', () => {
    expect(errorFor(loginSchema, { email: '', password: 'x' })).toContain('email:required');
  });

  it('reports a malformed email as "invalidEmail"', () => {
    expect(errorFor(loginSchema, { email: 'guest', password: 'x' })).toContain('email:invalidEmail');
  });

  it('requires a password', () => {
    expect(errorFor(loginSchema, { email: 'guest@chicago.ru', password: '' })).toContain('password:required');
  });

  it('does not apply the registration policy to an existing password', () => {
    expect(loginSchema.safeParse({ email: 'guest@chicago.ru', password: 'old' }).success).toBe(true);
  });
});

describe('registerSchema', () => {
  const VALID = {
    email: 'guest@chicago.ru',
    password: 'Password1',
    firstName: 'Амина',
    acceptPrivacyPolicy: true,
  };

  it('refuses a signup with the consent box unticked', () => {
    // 152-ФЗ: the agreement is given, never assumed.
    expect(errorFor(registerSchema, { ...VALID, acceptPrivacyPolicy: false })).toContain(
      'acceptPrivacyPolicy:consentRequired',
    );
    expect(errorFor(registerSchema, { ...VALID, acceptPrivacyPolicy: undefined })).toContain(
      'acceptPrivacyPolicy:consentRequired',
    );
  });

  it('accepts the minimal registration', () => {
    expect(registerSchema.safeParse(VALID).success).toBe(true);
  });

  it('accepts empty optional fields, which is what an untouched input sends', () => {
    expect(registerSchema.safeParse({ ...VALID, lastName: '', phone: '', referralCode: '' }).success).toBe(true);
  });

  it('accepts filled optional fields', () => {
    expect(
      registerSchema.safeParse({ ...VALID, lastName: 'Магомедова', phone: '+79280000000', referralCode: 'FRIEND01' })
        .success,
    ).toBe(true);
  });

  it.each([
    ['Pass1', 'passwordTooShort'],
    ['password1', 'passwordWeak'],
    ['PASSWORD1', 'passwordWeak'],
    ['Password', 'passwordWeak'],
  ])('rejects the password %p as %s', (password, key) => {
    expect(errorFor(registerSchema, { ...VALID, password })).toContain(`password:${key}`);
  });

  it('rejects a phone in any other format', () => {
    expect(errorFor(registerSchema, { ...VALID, phone: '89280000000' })).toContain('phone:invalidPhone');
  });

  it('requires a first name', () => {
    expect(errorFor(registerSchema, { ...VALID, firstName: '' })).toContain('firstName:required');
  });

  it('caps the names at fifty characters', () => {
    expect(registerSchema.safeParse({ ...VALID, firstName: 'я'.repeat(51) }).success).toBe(false);
    expect(registerSchema.safeParse({ ...VALID, lastName: 'я'.repeat(51) }).success).toBe(false);
  });
});

describe('verifyEmailSchema', () => {
  it('accepts exactly six characters', () => {
    expect(verifyEmailSchema.safeParse({ code: '123456' }).success).toBe(true);
  });

  it.each([['12345'], ['1234567'], ['']])('rejects %p with the codeLength key', (code) => {
    expect(errorFor(verifyEmailSchema, { code })).toContain('code:codeLength');
  });
});

describe('forgotPasswordSchema', () => {
  it('accepts a valid address', () => {
    expect(forgotPasswordSchema.safeParse({ email: 'guest@chicago.ru' }).success).toBe(true);
  });

  it('distinguishes empty from malformed', () => {
    expect(errorFor(forgotPasswordSchema, { email: '' })).toContain('email:required');
    expect(errorFor(forgotPasswordSchema, { email: 'guest' })).toContain('email:invalidEmail');
  });
});

describe('resetPasswordSchema', () => {
  it('applies the full password policy', () => {
    expect(resetPasswordSchema.safeParse({ newPassword: 'NewPass1' }).success).toBe(true);
    expect(errorFor(resetPasswordSchema, { newPassword: 'weak' })).toContain('newPassword:passwordTooShort');
    expect(errorFor(resetPasswordSchema, { newPassword: 'weakpassword' })).toContain('newPassword:passwordWeak');
  });

  it('caps the password at bcrypt’s limit', () => {
    expect(resetPasswordSchema.safeParse({ newPassword: `Aa1${'x'.repeat(70)}` }).success).toBe(false);
  });
});
