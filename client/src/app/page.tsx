import { getTranslations } from 'next-intl/server';
import { productApi } from '@/entities/product/api';
import { HomeProductGrid } from '@/widgets/home/home-product-grid';
import { Hero } from '@/widgets/home/hero';
import { SizeScale } from '@/widgets/home/size-scale';
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
    description: 'Пицца по-чикагски с доставкой по Махачкале за 45 минут.',
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
  // (good for SEO and for the Largest Contentful Paint metric). All three are
  // independent, so they go out together rather than one after another.
  const [popular, fresh, reviews, branches] = await Promise.all([
    productApi.list({ isPopular: true, limit: 8 }).catch(() => null),
    productApi.list({ isNew: true, limit: 4 }).catch(() => null),
    productApi.recentReviews(3).catch(() => []),
    productApi.branches().catch(() => []),
  ]);

  // The structured data describes a real place, so it names one: the first
  // branch, which is the one the marketing copy has always meant.
  const [flagship] = branches;

  const pizzas = (popular?.items ?? []).filter((product) => product.type === 'PIZZA');

  return (
    <>
      <RestaurantJsonLd
        address={flagship?.address ?? t('contacts.address.value')}
        phone={flagship?.phone ?? t('contacts.phone.value')}
        openMinute={flagship?.openMinute}
        closeMinute={flagship?.closeMinute}
      />

      <Hero />

      <SizeScale products={pizzas} />

      {popular?.items.length ? (
        <section className="container py-[clamp(2rem,5vw,4.5rem)]">
          <span className="section-kicker">{t('popularKicker')}</span>
          <h2 className="section-title mb-[clamp(1.5rem,3vw,2.5rem)]">{t('popular')}</h2>
          <HomeProductGrid products={popular.items} />
        </section>
      ) : null}

      {fresh?.items.length ? (
        <section className="container py-[clamp(2rem,5vw,4.5rem)]">
          <span className="section-kicker">{t('newKicker')}</span>
          <h2 className="section-title mb-[clamp(1.5rem,3vw,2.5rem)]">{t('new')}</h2>
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
