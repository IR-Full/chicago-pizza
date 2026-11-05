import { getTranslations } from 'next-intl/server';

const FACTS = ['since', 'minutes', 'sizes'] as const;

export async function About() {
  const t = await getTranslations('home');

  return (
    <section className="container py-[clamp(2.5rem,6vw,5.5rem)]">
      <div className="grid gap-7 lg:grid-cols-[0.95fr_1.05fr] lg:gap-16">
        <div className="min-w-0">
          <span className="section-kicker">{t('aboutKicker')}</span>
          <h2 className="section-title max-w-[21ch] text-balance uppercase">{t('aboutTitle')}</h2>
        </div>

        <div className="min-w-0 lg:pt-7">
          <p className="max-w-[54ch] text-base leading-[1.75] text-foreground/80">{t('aboutP1')}</p>
          <p className="mt-4 max-w-[54ch] text-base leading-[1.75] text-foreground/80">{t('aboutP2')}</p>

          <dl className="mt-7 grid grid-cols-3 gap-4 border-t border-border pt-6">
            {FACTS.map((fact) => (
              // Reversed so the number reads first visually while the markup
              // keeps the term before its description — and a screen reader
              // announces each label once, not twice.
              <div key={fact} className="flex flex-col-reverse">
                <dt className="mt-2 max-w-[14ch] text-xs leading-relaxed text-muted-foreground sm:text-sm">
                  {t(`facts.${fact}.label`)}
                </dt>
                <dd className="m-0 font-heading text-[clamp(1.9rem,3.5vw,2.8rem)] font-bold leading-none text-brand-700">
                  {t(`facts.${fact}.big`)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
