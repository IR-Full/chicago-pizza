import { getTranslations } from 'next-intl/server';
import { productApi } from '@/entities/product/api';
import { HomeProductGrid } from '@/widgets/home/home-product-grid';
import { Hero } from '@/widgets/home/hero';
import { SizeScale } from '@/widgets/home/size-scale';
import { Promos } from '@/widgets/home/promos';
import { About } from '@/widgets/home/about';
import { Contacts } from '@/widgets/home/contacts';
import { Reviews } from '@/widgets/home/reviews';

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
  const [popular, fresh, reviews] = await Promise.all([
    productApi.list({ isPopular: true, limit: 8 }).catch(() => null),
    productApi.list({ isNew: true, limit: 4 }).catch(() => null),
    productApi.recentReviews(3).catch(() => []),
  ]);

  const pizzas = (popular?.items ?? []).filter((product) => product.type === 'PIZZA');

  return (
    <>
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
