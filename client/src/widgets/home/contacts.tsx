import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button } from '@/shared/ui/button';
import { productApi } from '@/entities/product/api';
import { formatOpeningMinute } from '@/shared/config/delivery';

export async function Contacts() {
  const t = await getTranslations('home');
  const tc = await getTranslations('checkout');

  // Addresses come from the branches themselves now: hardcoded copy could not
  // survive opening a second kitchen, and this section is where a customer
  // looks for the one nearest them.
  const branches = await productApi.branches().catch(() => []);
  const phone = t('contacts.phone.value');

  return (
    <section
      id="contacts"
      className="container scroll-mt-24 pb-[clamp(3rem,6vw,6rem)] pt-[clamp(2rem,5vw,4.5rem)]"
    >
      <div className="grid items-start gap-8 border-t border-border pt-[clamp(2rem,4vw,3.5rem)] lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
        <div className="min-w-0 lg:sticky lg:top-28">
          <h2 className="m-0 max-w-[20ch] text-balance font-heading text-[clamp(1.875rem,3.7vw,3rem)] font-bold uppercase leading-[1.12]">
            {t('contactsTitle')}
          </h2>

          <dl className="mt-6">
            <dt className="text-sm font-semibold text-brand-700">{t('contacts.delivery.label')}</dt>
            <dd className="m-0 mt-2 text-base leading-relaxed text-foreground/80">
              {t('contacts.delivery.value')}
            </dd>
          </dl>

          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/menu">{t('orderDelivery')}</Link>
            </Button>
            <Button variant="outline" asChild>
              <a href={`tel:${phone.replace(/[^+\d]/g, '')}`}>{phone}</a>
            </Button>
          </div>
        </div>

        {branches.length > 0 && (
          <dl className="min-w-0 divide-y divide-border border-y border-border">
            {branches.map((branch) => (
              <div key={branch.id} className="py-5 first:pt-4 last:pb-4">
                <dt className="font-heading text-lg font-bold leading-snug">{branch.name}</dt>
                <dd className="m-0 mt-2 text-base leading-relaxed text-foreground/80">
                  {branch.address}
                  <span className="mt-1.5 block text-sm leading-relaxed text-muted-foreground">
                    {branch.phone} ·{' '}
                    {tc('branchHours', {
                      from: formatOpeningMinute(branch.openMinute),
                      to: formatOpeningMinute(branch.closeMinute),
                    })}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </section>
  );
}
