import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button } from '@/shared/ui/button';

/**
 * Opening screen: a sage circle bleeding off the top-right corner, the
 * promise in the display face, and the pizza itself as a round plate.
 */
export async function Hero() {
  const t = await getTranslations('home');

  return (
    <section className="container relative pb-[clamp(2.5rem,6vw,6rem)] pt-[clamp(1.75rem,5vw,4.5rem)]">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-44 right-0 z-0 aspect-square w-[min(460px,70%)] rounded-full bg-sage-200"
      />

      <div className="relative z-10 flex flex-wrap items-center gap-[clamp(1.5rem,4vw,4rem)]">
        <div className="min-w-0 flex-[1.15_1_420px]">
          <span className="inline-flex items-center rounded-full bg-brand-100 px-3.5 py-1.5 text-xs font-semibold tracking-[0.02em] text-brand-800">
            {t('badge')}
          </span>

          <h1 className="mt-5 font-heading text-[clamp(1.95rem,4.2vw,3.875rem)] font-black leading-[1.08] tracking-[-0.02em]">
            {t('heroTitle')}
          </h1>

          <p className="mt-5 max-w-[52ch] text-[17px] leading-relaxed text-foreground/80">{t('heroSubtitle')}</p>

          <div className="mt-7 flex flex-wrap gap-3">
            <Button size="lg" asChild>
              <Link href="/menu">{t('orderNow')}</Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <a href="#sizes">{t('compareSizes')}</a>
            </Button>
          </div>
        </div>

        <figure className="m-0 min-w-0 flex-[0.85_1_300px] max-w-[min(100%,460px)]">
          <div
            className="grid aspect-square w-full place-items-center overflow-hidden rounded-full bg-brand-200 text-[clamp(7rem,22vw,15rem)] leading-none shadow-lg"
            role="img"
            aria-label={t('heroImageAlt')}
          >
            <span aria-hidden>🍕</span>
          </div>
        </figure>
      </div>
    </section>
  );
}
