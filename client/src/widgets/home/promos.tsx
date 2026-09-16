import { getTranslations } from 'next-intl/server';

const PROMOS = ['delivery', 'loyalty', 'referral'] as const;

/** Three sage slabs — the standing offers, not a time-limited campaign. */
export async function Promos() {
  const t = await getTranslations('home');

  return (
    <section id="promos" className="container scroll-mt-24 py-[clamp(2rem,5vw,4.5rem)]">
      <span className="section-kicker">{t('promosKicker')}</span>
      <h2 className="section-title mb-[clamp(1.5rem,3vw,2.5rem)]">{t('promosTitle')}</h2>

      <div className="grid gap-[clamp(1rem,2vw,1.75rem)] sm:grid-cols-2 lg:grid-cols-3">
        {PROMOS.map((key) => (
          <div
            key={key}
            className="flex min-h-[210px] flex-col gap-2.5 rounded-blob bg-sage-100 p-[clamp(1.5rem,3vw,2.25rem)]"
          >
            <span className="font-heading text-[clamp(1.875rem,3vw,2.5rem)] font-black leading-none text-sage-800">
              {t(`promos.${key}.big`)}
            </span>
            <h3 className="mt-1.5 font-heading text-xl font-black">{t(`promos.${key}.title`)}</h3>
            <p className="m-0 text-[14.5px] leading-relaxed text-foreground/80">{t(`promos.${key}.body`)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
