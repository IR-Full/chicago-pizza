import { describe, expect, it } from 'vitest';
import type { Product } from '@/shared/api/types';
import { variantPhoto } from './variant-photo';

const kinza = {
  slug: 'kinza',
  variants: ['cola', 'orange', 'lime-mint', 'blueberry', 'pomegranate', 'lemon'].map((slug) => ({
    id: slug,
    slug,
    name: slug,
  })),
} as Product;

describe('Kinza flavour photographs', () => {
  it.each(['cola', 'orange', 'pomegranate', 'lemon'])('has an exact photograph for %s', (slug) => {
    expect(variantPhoto(kinza, slug)).toBe(`/menu/kinza-${slug}-340.webp`);
  });
  it.each(['cola-zero', 'lemon-zero', 'unknown'])('does not substitute another flavour for %s', (slug) => {
    expect(variantPhoto(kinza, slug)).toBeNull();
  });
  it('uses the corrected flavour names with stable legacy slugs', () => {
    expect(variantPhoto(kinza, 'blueberry')).toBe('/menu/kinza-blackcurrant-340.webp');
    expect(variantPhoto(kinza, 'lime-mint')).toBe('/menu/kinza-citrus-340.webp');
  });
  it('does not reuse branded photos for another product', () => {
    expect(variantPhoto({ ...kinza, slug: 'other-drink' }, 'cola')).toBeNull();
  });
});
