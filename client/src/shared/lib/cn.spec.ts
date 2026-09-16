import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('joins plain class names', () => {
    expect(cn('rounded-full', 'bg-primary')).toBe('rounded-full bg-primary');
  });

  it('drops falsy values', () => {
    expect(cn('btn', false && 'hidden', undefined, null, '')).toBe('btn');
  });

  it('applies conditional objects and arrays', () => {
    expect(cn({ 'bg-primary': true, 'bg-muted': false }, ['px-4', 'py-2'])).toBe('bg-primary px-4 py-2');
  });

  it('lets a later Tailwind utility win over an earlier conflicting one', () => {
    // This is why the helper exists: `className` overrides passed into a
    // component must beat the component's own defaults.
    expect(cn('bg-primary', 'bg-card')).toBe('bg-card');
    expect(cn('px-4', 'px-8')).toBe('px-8');
  });

  it('keeps utilities that only look similar', () => {
    expect(cn('px-4', 'py-2')).toBe('px-4 py-2');
    expect(cn('text-brand-700', 'bg-brand-100')).toBe('text-brand-700 bg-brand-100');
  });

  it('resolves conflicts across arbitrary values too', () => {
    expect(cn('rounded-card', 'rounded-full')).toBe('rounded-full');
  });

  it('returns an empty string for no input', () => {
    expect(cn()).toBe('');
  });
});
