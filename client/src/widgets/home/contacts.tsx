import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button } from '@/shared/ui/button';

const ROWS = ['address', 'phone', 'hours', 'delivery'] as const;

export async function Contacts() {
  const t = await getTranslations('home');

  return (
    <section id="contacts" className="container scroll-mt-24 pb-[clamp(3rem,6vw,6rem)] pt-[clamp(2rem,5vw,4.5rem)]">
      <div className="grid items-center gap-[clamp(1.5rem,4vw,3.5rem)] rounded-blob bg-card p-[clamp(1.5rem,3.5vw,3.25rem)] md:grid-cols-2">
        <div>
          <h2 className="m-0 font-heading text-[clamp(1.75rem,3.2vw,2.625rem)] font-black leading-[1.12]">
            {t('contactsTitle')}
          </h2>

          <dl className="mt-7 grid gap-[18px]">
            {ROWS.map((row) => (
              <div key={row}>
                <dt className="text-xs uppercase tracking-[0.08em] text-brand-700">{t(`contacts.${row}.label`)}</dt>
                <dd className="m-0 mt-1 text-[17px]">{t(`contacts.${row}.value`)}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-7 flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/menu">{t('orderDelivery')}</Link>
            </Button>
            <Button variant="outline" asChild>
              <a href="tel:+78722555555">+7 8722 55-55-55</a>
            </Button>
          </div>
        </div>

        <figure
          className="m-0 grid aspect-square w-full place-items-center overflow-hidden rounded-[calc(theme(borderRadius.blob)*0.8)] bg-sage-100 p-6 text-center"
          role="img"
          aria-label={t('mapPlaceholder')}
        >
          <span>
            <span aria-hidden className="block text-[clamp(3rem,10vw,6rem)] leading-none">
              🗺️
            </span>
            <span className="mt-3 block text-sm text-foreground/70">{t('mapPlaceholder')}</span>
          </span>
        </figure>
      </div>
    </section>
  );
}
