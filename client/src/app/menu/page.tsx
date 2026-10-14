import { Suspense } from 'react';
import type { Metadata } from 'next';
import { HydrationBoundary, QueryClient, dehydrate } from '@tanstack/react-query';
import { productApi } from '@/entities/product/api';
import { parseCatalogParams, readerFromRecord } from '@/entities/product/catalog-params';
import { productKeys } from '@/entities/product/keys';
import { CatalogView } from '@/widgets/catalog/catalog-view';
import { SITE_URL } from '@/shared/config/site';

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const filters = parseCatalogParams(readerFromRecord(await searchParams));
  const filtered = Boolean(
    filters.search ||
      filters.categorySlug ||
      filters.isHalal ||
      filters.isVegetarian ||
      filters.isSpicy ||
      filters.isNew ||
      filters.isPopular,
  );
  const canonical = `${SITE_URL}/menu${!filtered && (filters.page ?? 1) > 1 ? `?page=${filters.page}` : ''}`;
  return {
    title: 'Меню',
    description: 'Пиццы, закуски, напитки и десерты Chicago Pizza с доставкой по Махачкале.',
    alternates: { canonical },
    openGraph: {
      url: canonical,
      type: 'website',
      locale: 'ru_RU',
      siteName: 'Chicago Pizza',
      title: 'Меню — Чикаго Пицца, Махачкала',
      description: 'Пиццы, закуски, напитки и десерты с доставкой по Махачкале.',
    },
    ...(filtered ? { robots: { index: false, follow: true } } : {}),
  };
}

/**
 * The menu.
 *
 * The route reads `searchParams`, so it renders per request — but the catalog
 * fetches below carry a `revalidate` window (see `productApi`), so the gateway
 * is asked once every five minutes rather than once per visitor. Same bargain
 * the home page strikes.
 *
 * What is new here is that the products are fetched *on the server* and handed
 * to the widget already resolved. Before this, `/menu` shipped an empty
 * skeleton and the browser went and got the menu itself: the most commercially
 * important page in the shop had no menu in its HTML, which costs both the
 * Largest Contentful Paint and anything a crawler might have indexed.
 */
export default async function MenuPage({
  searchParams,
}: {
  // Next 15 hands `searchParams` in as a promise, so the page awaits it.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const filters = parseCatalogParams(readerFromRecord(params));

  const queryClient = new QueryClient();

  // Both are independent, so they go out together. `prefetchQuery` swallows
  // failures on purpose: a gateway hiccup should still render the page and let
  // the browser retry, not turn the menu into an error screen.
  await Promise.all([
    queryClient.prefetchQuery({
      // The key has to be the one `CatalogView` subscribes to, which is why
      // both sides derive their filters from `parseCatalogParams`.
      queryKey: productKeys.list(filters),
      queryFn: () => productApi.list(filters),
    }),
    queryClient.prefetchQuery({
      queryKey: productKeys.categories,
      queryFn: productApi.categories,
    }),
  ]);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      {/* `useSearchParams` suspends, and the boundary is what keeps that from
          bubbling up to the whole route. */}
      <Suspense fallback={null}>
        <CatalogView />
      </Suspense>
    </HydrationBoundary>
  );
}
