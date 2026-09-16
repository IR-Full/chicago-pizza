import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { Product } from '@/shared/api/types';
import { formatPrice } from '@/shared/lib/format';
import { cn } from '@/shared/lib/cn';

/** Per-size tone, biggest one in sage so the family size reads as the hero. */
const TONES: Record<number, string> = {
  30: 'bg-brand-100 text-brand-800',
  45: 'bg-brand-200 text-brand-800',
  60: 'bg-sage-300 text-sage-900',
};

/**
 * The three pizza diameters drawn to scale — a 60 cm circle is literally
 * twice the 30 cm one, which is the whole point of the pizzeria.
 */
export async function SizeScale({ products }: { products: Product[] }) {
  const t = await getTranslations('home');
  const tc = await getTranslations('common');

  // Cheapest pizza per diameter, straight from the catalog.
  const cheapest = new Map<number, number>();
  for (const product of products) {
    for (const size of product.sizes) {
      const current = cheapest.get(size.sizeCm);
      if (current === undefined || size.price < current) cheapest.set(size.sizeCm, size.price);
    }
  }

  const sizes = [...cheapest.keys()].sort((a, b) => a - b).filter((cm) => cm in TONES);
  if (!sizes.length) return null;

  return (
    <section id="sizes" className="container scroll-mt-24 py-[clamp(2rem,5vw,5rem)]">
      <span className="section-kicker">{t('sizesKicker')}</span>
      <h2 className="section-title max-w-[20ch]">{t('sizesTitle')}</h2>

      <div
        className="no-scrollbar -mx-4 mt-[clamp(0.75rem,4vw,2.5rem)] flex snap-x snap-proximity items-end gap-[clamp(1rem,3vw,3rem)] overflow-x-auto px-4 pb-5 pt-4"
        style={{ ['--u' as string]: 'clamp(2.5px,0.33vw,4.1px)' }}
      >
        {sizes.map((cm) => (
          <Link
            key={cm}
            href="/menu"
            className="group shrink-0 snap-center text-center focus-visible:outline-none"
          >
            <span className="relative block">
              <span
                aria-hidden
                className="pointer-events-none absolute -inset-3 rounded-full border-[2.75px] border-primary opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
              />
              <span
                className={cn(
                  'grid aspect-square place-content-center rounded-full',
                  TONES[cm],
                )}
                style={{ width: `calc(${cm} * var(--u))` }}
              >
                <span className="font-heading text-[clamp(1.25rem,2.4vw,3.25rem)] font-black leading-none">
                  {cm}
                </span>
                <span className="mt-1 text-xs uppercase tracking-[0.08em]">{t('cm')}</span>
              </span>
            </span>

            <span className="mt-[18px] block font-heading text-lg font-black">{t(`sizes.${cm}.title`)}</span>
            <span className="mt-1.5 block text-sm text-foreground/70">{t(`sizes.${cm}.slices`)}</span>
            <span className="mt-0.5 block text-sm text-brand-700">
              {tc('from')} {formatPrice(cheapest.get(cm)!)}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
