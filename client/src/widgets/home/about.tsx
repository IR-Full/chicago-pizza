import { getTranslations } from 'next-intl/server';

const FACTS = ['since', 'minutes', 'sizes'] as const;

export async function About() {
  const t = await getTranslations('home');

  return (
    <section className="container py-[clamp(2rem,5vw,4.5rem)]">
      <div className="grid items-center gap-[clamp(1.5rem,4vw,4.5rem)] md:grid-cols-2">
        <figure
          className="m-0 grid aspect-[4/5] w-full place-items-center overflow-hidden rounded-[calc(theme(borderRadius.blob)*1.2)] bg-sage-100 text-[clamp(5rem,14vw,10rem)]"
          role="img"
          aria-label={t('aboutImageAlt')}
        >
          <span aria-hidden>🔥</span>
        </figure>

        <div>
          <span className="section-kicker">{t('aboutKicker')}</span>
          <h2 className="section-title">{t('aboutTitle')}</h2>
          <p className="mt-5 max-w-[54ch] text-[16.5px] leading-[1.7] text-foreground/80">{t('aboutP1')}</p>
          <p className="mt-4 max-w-[54ch] text-[16.5px] leading-[1.7] text-foreground/80">{t('aboutP2')}</p>

          <dl className="mt-8 flex flex-wrap gap-[clamp(1.125rem,3vw,2.75rem)]">
            {FACTS.map((fact) => (
              // Reversed so the number reads first visually while the markup
              // keeps the term before its description — and a screen reader
              // announces each label once, not twice.
              <div key={fact} className="flex flex-col-reverse">
                <dt className="mt-2 text-[13px] uppercase tracking-[0.04em] text-foreground/70">
                  {t(`facts.${fact}.label`)}
                </dt>
                <dd className="m-0 font-heading text-[clamp(1.625rem,2.6vw,2.125rem)] font-black leading-none text-brand-700">
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
