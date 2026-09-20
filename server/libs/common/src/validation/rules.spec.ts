import {
  NAME_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_PATTERN,
  PASSWORD_RULE_MESSAGE,
  PHONE_PATTERN,
  PHONE_RULE_MESSAGE,
  VERIFICATION_CODE_LENGTH,
} from './rules';

/**
 * One definition for rules the gateway and the auth service both enforce.
 * Previously each had its own copy, in different languages.
 */
describe('password rule', () => {
  it.each([['Password1'], ['aA1xxxxx'], ['Пароль1aA']])('accepts %p', (password) => {
    expect(PASSWORD_PATTERN.test(password)).toBe(true);
  });

  it.each([
    ['no digit', 'Password'],
    ['no uppercase', 'password1'],
    ['no lowercase', 'PASSWORD1'],
  ])('rejects a password with %s', (_label, password) => {
    expect(PASSWORD_PATTERN.test(password)).toBe(false);
  });

  it('stops at bcrypt’s 72-byte limit', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    expect(PASSWORD_MAX_LENGTH).toBe(72);
  });

  it('explains itself in Russian, like every other message the customer sees', () => {
    expect(PASSWORD_RULE_MESSAGE).toMatch(/[а-яё]/i);
  });
});

describe('phone rule', () => {
  it('accepts the canonical Russian format', () => {
    expect(PHONE_PATTERN.test('+79280000000')).toBe(true);
  });

  it.each([['89280000000'], ['+7928000000'], ['+792800000001'], ['+7 928 000 00 00'], ['']])(
    'rejects %p',
    (phone) => {
      expect(PHONE_PATTERN.test(phone)).toBe(false);
    },
  );

  it('explains itself in Russian', () => {
    expect(PHONE_RULE_MESSAGE).toMatch(/[а-яё]/i);
  });
});

describe('field limits', () => {
  it('bounds names and the verification code', () => {
    expect(NAME_MAX_LENGTH).toBe(50);
    expect(VERIFICATION_CODE_LENGTH).toBe(6);
  });
});
