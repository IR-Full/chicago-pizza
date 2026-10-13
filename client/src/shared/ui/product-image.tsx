import { cn } from '@/shared/lib/cn';

/**
 * The widths `scripts/prepare-menu-images.mjs` writes into
 * `client/public/menu`. Keep the two in step: a width listed here that the
 * script does not emit becomes a 404 the browser may pick.
 */
const VARIANT_WIDTHS = [160, 340, 768];

/**
 * Matches our own pre-sized files — `/menu/pepperoni-340.webp` — and nothing
 * else. What the catalogue stores is a complete, working URL; the suffix is
 * the part that lets us offer the browser the other sizes too.
 */
const LOCAL_VARIANT = /^(\/menu\/[a-z0-9-]+)-\d+\.webp$/;

interface ProductImageProps {
  /** `imageUrl` straight off the product, or null when there is no photo. */
  src: string;
  alt: string;
  /**
   * The CSS width the image is drawn at, as a `sizes` attribute. Without it
   * the browser assumes the image fills the viewport and fetches the largest
   * variant every time, which would undo the point of having small ones.
   */
  sizes: string;
  className?: string;
  /**
   * Set on the one image that is likely above the fold on its page (the
   * product detail photo). Everything in a scrolling grid stays lazy.
   */
  priority?: boolean;
}

/**
 * A product photo, served at a sensible size.
 *
 * Deliberately a plain `<img>`: `next/image` is switched off in
 * `next.config.mjs` (`images.unoptimized`) so that `/_next/image` is not a
 * live route, and the files here are already pre-sized, so there is nothing
 * for an optimizer to do. The originals are 1000×1000 and the grid draws
 * them at 170 px — serving those directly was 2.4 MB of menu page.
 *
 * A URL that is not one of ours — a CDN, once there is one — is rendered as
 * given, with no `srcset` invented for files that may not exist.
 */
export function ProductImage({ src, alt, sizes, className, priority = false }: ProductImageProps) {
  const base = LOCAL_VARIANT.exec(src)?.[1];

  return (
    // eslint-disable-next-line @next/next/no-img-element -- see the note above: the optimizer is off by design
    <img
      src={src}
      srcSet={base ? VARIANT_WIDTHS.map((w) => `${base}-${w}.webp ${w}w`).join(', ') : undefined}
      sizes={base ? sizes : undefined}
      alt={alt}
      // Square, and known before the pixels arrive, so a card does not jump
      // as photos load.
      width={340}
      height={340}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : 'auto'}
      decoding="async"
      className={cn('h-full w-full object-cover', className)}
    />
  );
}
