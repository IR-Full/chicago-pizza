import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { DELIVERY_FEE_KOPECKS, FREE_DELIVERY_THRESHOLD_KOPECKS } from '@/shared/config/delivery';
import { formatPrice } from '@/shared/lib/format';

export async function Footer() {
  const t = await getTranslations('common');
  const nav = await getTranslations('nav');
  const f = await getTranslations('footer');
  const legal = await getTranslations('legal');
  const locale = await getLocale();

  const columnTitle = 'text-xs uppercase tracking-[0.08em] text-brand-700';

  return (
    <footer className="container pb-4 pt-[clamp(1.75rem,4vw,4rem)]">
      <div className="grid gap-[clamp(1.5rem,3vw,3rem)] sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="flex items-center gap-2.5 font-heading text-[19px] font-black">
            <span
              aria-hidden
              className="grid h-8 w-8 place-items-center rounded-full bg-primary text-base leading-none text-primary-foreground"
            >
              {locale === 'ru' ? 'Ч' : 'C'}
            </span>
            <span>{t('brand')}</span>
          </div>
          <p className="mt-3.5 max-w-[32ch] text-[14.5px] leading-relaxed text-foreground/75">{f('tagline')}</p>
          <a
            href="tel:+78722555555"
            className="mt-4 inline-flex h-11 items-center rounded-full border border-border px-5 font-heading text-[15px] font-black transition-colors hover:bg-foreground/[0.07]"
          >
            +7 8722 55-55-55
          </a>
        </div>

        <div>
          <div className={columnTitle}>{nav('menu')}</div>
          <div className="mt-3.5 grid justify-items-start gap-2.5 text-[15px]">
            <Link href="/menu" className="py-1 transition-colors hover:text-brand-700">
              {nav('menu')}
            </Link>
            <Link href="/#promos" className="py-1 transition-colors hover:text-brand-700">
              {f('offers')}
            </Link>
            <Link href="/orders" className="py-1 transition-colors hover:text-brand-700">
              {nav('orders')}
            </Link>
            <Link href="/support" className="py-1 transition-colors hover:text-brand-700">
              {nav('support')}
            </Link>
          </div>
        </div>

        <div>
          <div className={columnTitle}>{f('pizzeria')}</div>
          <div className="mt-3.5 grid justify-items-start gap-2.5 text-[15px] leading-normal text-foreground/80">
            <span>{f('address')}</span>
            <span>{f('hours')}</span>
            <Link href="/#contacts" className="py-1 text-brand-700 transition-colors hover:text-brand-600">
              {f('deliveryArea')}
            </Link>
          </div>
        </div>

        <div>
          <div className={columnTitle}>{f('delivery')}</div>
          <div className="mt-3.5 grid gap-2.5 text-[15px] leading-normal text-foreground/80">
            <span>
              {f('deliveryPrice', {
                fee: formatPrice(DELIVERY_FEE_KOPECKS, locale),
                threshold: formatPrice(FREE_DELIVERY_THRESHOLD_KOPECKS, locale),
              })}
            </span>
            <span>{f('deliveryTime')}</span>
            <span>{f('deliveryPayment')}</span>
          </div>
        </div>
      </div>

      <div className="mt-[clamp(1.25rem,3vw,2.25rem)] flex flex-wrap items-center justify-between gap-3.5 text-[13px] text-foreground/65">
        <span>
          © {new Date().getFullYear()} {t('brand')}, {t('city')}
        </span>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {/* Reachable from every page: the signup checkbox links to the same
              documents, and a policy nobody can find afterwards is not one. */}
          <Link href="/privacy" className="py-1 transition-colors hover:text-brand-700">
            {legal('privacy')}
          </Link>
          <Link href="/terms" className="py-1 transition-colors hover:text-brand-700">
            {legal('terms')}
          </Link>
          <span>{f('priceNote')}</span>
        </div>
      </div>
    </footer>
  );
}
