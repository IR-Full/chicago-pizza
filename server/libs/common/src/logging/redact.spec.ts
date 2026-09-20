import { maskEmail, redactUrl, shortId } from './redact';

/**
 * Logs are read by more people than the database, kept for longer, and
 * shipped to third parties without much thought. Every request URL was being
 * written out in full and every outgoing email with its recipient, so
 * `docker compose logs` held customer addresses and working password-reset
 * links.
 */
describe('maskEmail', () => {
  it('keeps an address recognisable without spelling it out', () => {
    expect(maskEmail('guest@chicago.ru')).toBe('g***t@chicago.ru');
  });

  it('does not expose a short local part it cannot mask', () => {
    expect(maskEmail('ab@chicago.ru')).toBe('a@chicago.ru');
    expect(maskEmail('a@chicago.ru')).toBe('a@chicago.ru');
  });

  it('keeps the domain, which is what makes a delivery failure debuggable', () => {
    expect(maskEmail('amina.magomedova@yandex.ru')).toContain('@yandex.ru');
  });

  it('refuses to guess at something that is not an address', () => {
    expect(maskEmail('not-an-address')).toBe('***');
    expect(maskEmail('')).toBe('***');
  });
});

describe('redactUrl', () => {
  it('leaves a plain path alone', () => {
    expect(redactUrl('/api/orders')).toBe('/api/orders');
  });

  it('strips a password-reset token', () => {
    // The log line used to be a working reset link for anyone who read it.
    expect(redactUrl('/api/auth/reset-password?token=abc123')).toBe('/api/auth/reset-password?token=[redacted]');
  });

  it.each([
    ['code', '/api/auth/verify-email?code=424242'],
    ['email', '/api/auth/resend?email=guest@chicago.ru'],
    ['phone', '/api/admin/users?phone=%2B79280000000'],
    ['search', '/api/products?search=халяль'],
  ])('strips the %s parameter', (_name, url) => {
    expect(redactUrl(url)).toContain('=[redacted]');
    expect(redactUrl(url)).not.toContain('424242');
  });

  it('keeps parameters that describe the request rather than the person', () => {
    expect(redactUrl('/api/products?page=2&limit=20')).toBe('/api/products?page=2&limit=20');
  });

  it('redacts only the sensitive half of a mixed query', () => {
    const redacted = redactUrl('/api/products?page=2&search=пепперони');

    expect(redacted).toContain('page=2');
    expect(redacted).toContain('search=[redacted]');
  });

  it('is not fooled by capitalisation', () => {
    expect(redactUrl('/api/auth/reset?TOKEN=abc')).toBe('/api/auth/reset?TOKEN=[redacted]');
  });

  it('survives a malformed query string', () => {
    expect(() => redactUrl('/api/products?')).not.toThrow();
    expect(() => redactUrl('/api/products?&&')).not.toThrow();
    expect(redactUrl('/api/products?flag')).toBe('/api/products?flag');
  });
});

describe('shortId', () => {
  it('is enough to follow one person through a log, not to identify them', () => {
    expect(shortId('3f2a1b4c-5d6e-7f80-9a1b-2c3d4e5f6071')).toBe('3f2a1b4c');
  });
});
