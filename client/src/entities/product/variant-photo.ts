import type { Product } from '@/shared/api/types';

// The legacy slugs stay stable so existing carts keep their variant IDs.
// Their display names have been corrected to the flavours on the cans.
const KINZA_PHOTOS: Record<string, string> = {
  cola: '/menu/kinza-cola-340.webp',
  orange: '/menu/kinza-orange-340.webp',
  pomegranate: '/menu/kinza-pomegranate-340.webp',
  lemon: '/menu/kinza-lemon-340.webp',
  'lime-mint': '/menu/kinza-citrus-340.webp',
  blueberry: '/menu/kinza-blackcurrant-340.webp',
};

export function variantPhoto(product: Product, variantId?: string): string | null {
  if (product.slug !== 'kinza') return null;
  const variant = product.variants?.find((item) => item.id === variantId);
  return variant ? (KINZA_PHOTOS[variant.slug] ?? null) : null;
}
