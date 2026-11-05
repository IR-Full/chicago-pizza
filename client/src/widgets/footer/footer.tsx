import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  CLOSE_MINUTE,
  DELIVERY_FEE_KOPECKS,
  formatOpeningMinute,
  FREE_DELIVERY_THRESHOLD_KOPECKS,
  OPEN_MINUTE,
} from '@/shared/config/delivery';
import { formatPrice } from '@/shared/lib/format';

const columnTitle = 'font-heading text-lg font-semibold uppercase leading-tight';
const footerLink = 'inline-flex min-h-11 items-center text-foreground/80 underline-offset-4 hover:underline';

export async function Footer() {
  const t = await getTranslations('common');
  const nav = await getTranslations('nav');
  const f = await getTranslations('footer');
  const legal = await getTranslations('legal');
  const locale = await getLocale();

  return (
    <footer className="border-t border-border bg-card">
      <div className="container pb-6 pt-[clamp(2rem,4vw,4rem)]">
        <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:gap-x-7 lg:grid-cols-4">
          <div className="col-span-2 sm:col-span-1">
            <Link
              href="/"
              className="block w-min font-heading text-[1.75rem] font-bold uppercase leading-[0.9] tracking-[-0.035em]"
            >
              {t('brand')}
            </Link>
            <p className="mt-3.5 max-w-[32ch] text-[14.5px] leading-relaxed text-foreground/75">
              {f('tagline')}
            </p>
            <a
              href="tel:+78722555555"
              className="mt-2 inline-flex min-h-11 items-center text-base font-bold underline-offset-4 hover:underline"
            >
              +7 8722 55-55-55
            </a>
          </div>

          <div>
            <h2 className={columnTitle}>{nav('menu')}</h2>
            <div className="mt-1.5 grid justify-items-start text-sm">
              <Link href="/menu" className={footerLink}>
                {nav('menu')}
              </Link>
              <Link href="/#promos" className={footerLink}>
                {f('offers')}
              </Link>
              <Link href="/orders" className={footerLink}>
                {nav('orders')}
              </Link>
              <Link href="/support" className={footerLink}>
                {nav('support')}
              </Link>
            </div>
          </div>

          <div>
            <h2 className={columnTitle}>{f('pizzeria')}</h2>
            <div className="mt-3.5 grid justify-items-start gap-2.5 text-sm leading-relaxed text-foreground/80">
              <span>{f('address')}</span>
              {/* The chain's usual hours. One branch works until six in the
                  morning; the branch list on the home page says so per shop. */}
              <span>
                {f('hours', {
                  from: formatOpeningMinute(OPEN_MINUTE),
                  to: formatOpeningMinute(CLOSE_MINUTE),
                })}
              </span>
              <Link href="/#contacts" className={footerLink}>
                {f('deliveryArea')}
              </Link>
            </div>
          </div>

          <div className="col-span-2 sm:col-span-1">
            <h2 className={columnTitle}>{f('delivery')}</h2>
            <div className="mt-3.5 grid gap-2.5 text-sm leading-relaxed text-foreground/80">
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

        <div className="mt-[clamp(1.5rem,3vw,2.25rem)] flex flex-wrap items-center justify-between gap-x-4 border-t border-border pt-4 text-[13px] text-muted-foreground">
          <span>
            © {new Date().getFullYear()} {t('brand')}, {t('city')}
          </span>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {/* Reachable from every page: the signup checkbox links to the same
                documents, and a policy nobody can find afterwards is not one. */}
            <Link href="/privacy" className={footerLink}>
              {legal('privacy')}
            </Link>
            <Link href="/terms" className={footerLink}>
              {legal('terms')}
            </Link>
            <span>{f('priceNote')}</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
