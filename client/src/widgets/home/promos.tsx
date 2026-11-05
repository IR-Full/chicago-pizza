import { getLocale, getTranslations } from 'next-intl/server';
import { DELIVERY_FEE_KOPECKS, FREE_DELIVERY_THRESHOLD_KOPECKS } from '@/shared/config/delivery';
import { formatPrice } from '@/shared/lib/format';

const PROMOS = ['delivery', 'loyalty', 'referral'] as const;

/** The standing offers, including the current delivery tariff. */
export async function Promos() {
  const t = await getTranslations('home');
  const locale = await getLocale();
  // The tariff is interpolated rather than written into the copy, so a price
  // change cannot leave the marketing text contradicting the checkout total.
  const tariff = {
    fee: formatPrice(DELIVERY_FEE_KOPECKS, locale),
    threshold: formatPrice(FREE_DELIVERY_THRESHOLD_KOPECKS, locale),
  };

  return (
    <section id="promos" className="scroll-mt-24 border-y border-border bg-card">
      <div className="container py-[clamp(2rem,5vw,4.5rem)]">
        <span className="section-kicker">{t('promosKicker')}</span>
        <h2 className="section-title max-w-[25ch] uppercase">{t('promosTitle')}</h2>

        <div className="mt-7 grid divide-y divide-border border-t-2 border-primary md:grid-cols-3 md:divide-x md:divide-y-0">
          {PROMOS.map((key) => (
            <div key={key} className="py-6 md:px-5 md:py-8 md:first:pl-0 md:last:pr-0 lg:px-8">
              <span className="font-heading text-[clamp(2.35rem,4.5vw,4rem)] font-bold leading-none text-brand-700">
                {t(`promos.${key}.big`)}
              </span>
              <h3 className="mt-4 font-heading text-xl font-bold uppercase">{t(`promos.${key}.title`)}</h3>
              <p className="mt-2 max-w-[40ch] text-base leading-relaxed text-foreground/80">
                {t(`promos.${key}.body`, tariff)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
