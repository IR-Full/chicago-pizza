import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import type { Product } from '@/shared/api/types';
import { formatPrice } from '@/shared/lib/format';
import { cn } from '@/shared/lib/cn';

/** The three diameters pictured in the size guide. */
const TONES: Record<number, string> = {
  45: 'border-border bg-card text-card-foreground',
  50: 'border-primary/55 bg-brand-100 text-brand-800',
  60: 'border-primary bg-primary text-primary-foreground',
};

/** Cheapest pizza per displayed diameter, straight from the catalog. */
export function getPizzaSizes(products: Product[]) {
  const cheapest = new Map<number, number>();
  for (const product of products) {
    if (product.type !== 'PIZZA') continue;
    for (const size of product.sizes) {
      if (!(size.sizeCm in TONES)) continue;
      const current = cheapest.get(size.sizeCm);
      if (current === undefined || size.price < current) cheapest.set(size.sizeCm, size.price);
    }
  }

  return [...cheapest].sort(([a], [b]) => a - b);
}

/** The three pizza diameters are drawn to scale. */
export async function SizeScale({ products }: { products: Product[] }) {
  const sizes = getPizzaSizes(products);
  if (!sizes.length) return null;
  const t = await getTranslations('home');
  const tc = await getTranslations('common');
  const locale = await getLocale();

  return (
    <section id="sizes" className="container scroll-mt-24 border-t border-border py-[clamp(2rem,5vw,5rem)]">
      <span className="section-kicker">{t('sizesKicker')}</span>
      <h2 className="section-title max-w-[24ch] uppercase">{t('sizesTitle')}</h2>

      <div
        className="mx-auto mt-[clamp(1.25rem,4vw,3rem)] grid max-w-[54rem] grid-cols-3 items-end gap-2 sm:gap-6"
        style={{ ['--u' as string]: 'clamp(1.2px,0.39vw,3.6px)' }}
      >
        {sizes.map(([cm, price]) => (
          <Link key={cm} href="/menu" className="group grid min-w-0 justify-items-center text-center">
            <span className="relative block">
              <span
                aria-hidden
                className="pointer-events-none absolute -inset-1.5 rounded-full border border-primary opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
              />
              <span
                className={cn('grid aspect-square place-content-center rounded-full border', TONES[cm])}
                style={{ width: `calc(${cm} * var(--u))` }}
              >
                <span className="font-heading text-[clamp(1.5rem,4vw,3.75rem)] font-bold leading-none">
                  {cm}
                </span>
                <span className="mt-1 text-xs uppercase tracking-[0.08em]">{t('cm')}</span>
              </span>
            </span>

            <span className="mt-3 block font-heading text-[clamp(0.85rem,2vw,1.35rem)] font-bold leading-tight">
              {t(`sizes.${cm}.title`)}
            </span>
            <span className="mt-1.5 block text-xs font-semibold text-brand-700 sm:text-sm">
              {tc('from')} {formatPrice(price, locale)}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
