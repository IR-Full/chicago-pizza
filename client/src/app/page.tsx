import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { productApi } from '@/entities/product/api';
import { HomeProductGrid } from '@/widgets/home/home-product-grid';
import { Hero } from '@/widgets/home/hero';
import { getPizzaSizes, SizeScale } from '@/widgets/home/size-scale';
import { Promos } from '@/widgets/home/promos';
import { About } from '@/widgets/home/about';
import { Contacts } from '@/widgets/home/contacts';
import { Reviews } from '@/widgets/home/reviews';
import { RestaurantJsonLd } from '@/widgets/home/restaurant-json-ld';
import type { Metadata } from 'next';
import { SITE_URL } from '@/shared/config/site';

export const metadata: Metadata = {
  alternates: { canonical: `${SITE_URL}/` },
  openGraph: {
    url: `${SITE_URL}/`,
    type: 'website',
    locale: 'ru_RU',
    siteName: 'Chicago Pizza',
    title: 'Чикаго Пицца (Chicago Pizza) — доставка пиццы в Махачкале',
    description:
      'Меню Чикаго Пицца: пиццы 45, 50 и 60 см, закуски и напитки. Доставка и самовывоз в Махачкале.',
  },
};

// The route itself stays dynamic — the locale lives in a cookie, so every
// render has to read the request. What matters is that the catalog fetches
// below are cacheable (`revalidate` in `productApi`), so the gateway is hit
// once every five minutes instead of once per visitor.
export const revalidate = 300;

export default async function HomePage() {
  const t = await getTranslations('home');

  // Fetched on the server so the first paint already contains the menu
  // (good for SEO and the Largest Contentful Paint metric). All requests
  // are independent, so they go out together.
  const [popular, fresh, reviews, branches, categories] = await Promise.all([
    productApi.list({ isPopular: true, limit: 8 }).catch(() => null),
    productApi.list({ isNew: true, limit: 4 }).catch(() => null),
    productApi.recentReviews(3).catch(() => []),
    productApi.branches().catch(() => []),
    productApi.categories().catch(() => []),
  ]);

  // Location data is published only after the owner verifies the business.
  const [flagship] = branches;

  const popularItems = popular?.items ?? [];
  const pizzaSizes = getPizzaSizes(popularItems);

  return (
    <>
      <RestaurantJsonLd
        address={flagship?.address ?? t('contacts.address.value')}
        phone={flagship?.phone ?? t('contacts.phone.value')}
        openMinute={flagship?.openMinute}
        closeMinute={flagship?.closeMinute}
        verified={process.env.BUSINESS_PROFILE_VERIFIED === 'true' && Boolean(flagship)}
      />

      <Hero sizes={pizzaSizes.map(([cm]) => cm)} />

      <section className="container pb-[clamp(2rem,4vw,4rem)] pt-4 sm:pt-6" aria-labelledby="home-menu-title">
        <div className="mb-1 border-b border-border sm:mb-2 lg:flex lg:items-center lg:gap-8">
          <h2
            id="home-menu-title"
            className="font-heading text-[clamp(1.75rem,4.3vw,3.5rem)] font-bold uppercase leading-tight tracking-tight lg:pb-3"
          >
            {t('popular')}
          </h2>
          <nav
            aria-label={t('menuCategories')}
            className="flex min-w-0 flex-wrap items-center gap-x-5 text-sm font-semibold sm:gap-x-7"
          >
            {categories.length ? (
              categories.map((category) => {
                const label = `categoryLabels.${category.slug}`;
                return (
                  <Link
                    key={category.id}
                    href={{ pathname: '/menu', query: { category: category.slug } }}
                    className="inline-flex min-h-11 items-center border-b-2 border-transparent transition-colors hover:border-primary hover:text-primary"
                  >
                    {t.has(label) ? t(label) : category.name}
                  </Link>
                );
              })
            ) : (
              <Link
                href="/menu"
                className="inline-flex min-h-11 items-center border-b-2 border-transparent transition-colors hover:border-primary hover:text-primary"
              >
                {t('allMenu')}
              </Link>
            )}
          </nav>
        </div>
        {popularItems.length > 0 && <HomeProductGrid products={popularItems} />}
      </section>

      <SizeScale products={popularItems} />

      {fresh?.items.length ? (
        <section className="container border-t border-border py-[clamp(2rem,5vw,4.5rem)]">
          <h2 className="mb-4 font-heading text-[clamp(1.75rem,4.3vw,3.5rem)] font-bold uppercase leading-tight tracking-tight">
            {t('new')}
          </h2>
          <HomeProductGrid products={fresh.items} />
        </section>
      ) : null}

      <Promos />
      <About />
      <Reviews reviews={reviews} />
      <Contacts />
    </>
  );
}
