import { getTranslations } from 'next-intl/server';
import { productApi } from '@/entities/product/api';
import { HomeProductGrid } from '@/widgets/home/home-product-grid';
import { Hero } from '@/widgets/home/hero';
import { SizeScale } from '@/widgets/home/size-scale';
import { Promos } from '@/widgets/home/promos';
import { About } from '@/widgets/home/about';
import { Contacts } from '@/widgets/home/contacts';
import { Reviews, type HomeReview } from '@/widgets/home/reviews';

// The home page is mostly static catalog content — revalidate rather than
// re-fetching per request.
export const revalidate = 300;

/** Newest commented review of each of the first few popular products. */
async function collectReviews(slugs: string[]): Promise<HomeReview[]> {
  const details = await Promise.all(slugs.map((slug) => productApi.get(slug).catch(() => null)));

  return details.flatMap((product) => {
    const review = product?.reviews?.find((item) => item.comment && item.comment.trim().length > 20);
    if (!product || !review?.comment) return [];
    return [{ comment: review.comment, rating: review.rating, productName: product.name }];
  });
}

export default async function HomePage() {
  const t = await getTranslations('home');

  // Fetched on the server so the first paint already contains the menu
  // (good for SEO and for the Largest Contentful Paint metric).
  const popular = await productApi.list({ isPopular: true, limit: 8 }).catch(() => null);
  const fresh = await productApi.list({ isNew: true, limit: 4 }).catch(() => null);

  const pizzas = (popular?.items ?? []).filter((product) => product.type === 'PIZZA');
  const reviews = await collectReviews(pizzas.slice(0, 3).map((product) => product.slug));

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
