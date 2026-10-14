import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ApiError } from '@/shared/api/api-client';
import { SITE_URL } from '@/shared/config/site';
import { kopecksToRubles } from '@/shared/lib/format';
import type { Product } from '@/shared/api/types';
import { productApi } from '@/entities/product/api';
import { ProductDetail } from '@/widgets/product-detail/product-detail';

/**
 * Fetches the product, treating "no such item" as a 404 rather than a crash.
 *
 * Both `generateMetadata` and the page itself call this. Next dedupes the two
 * fetches within one request, so the API is hit once.
 */
async function loadProduct(slug: string): Promise<Product | null> {
  try {
    return await productApi.get(slug);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const product = await loadProduct(slug);

  if (!product) return { title: 'Товар не найден' };

  // A menu item's own words beat a template: this is the text that decides
  // whether the search result gets clicked.
  const description =
    product.description ??
    `${product.name} — доставка по Махачкале от ${kopecksToRubles(product.priceFrom)} ₽.`;
  const canonical = `${SITE_URL}/menu/${product.slug}`;

  return {
    title: product.name,
    description,
    alternates: { canonical },
    openGraph: {
      type: 'website',
      title: `${product.name} — Chicago Pizza`,
      description,
      url: canonical,
      images: product.imageUrl ? [product.imageUrl] : undefined,
    },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await loadProduct(slug);

  if (!product) notFound();

  return (
    <>
      {/*
        Structured data, so a search engine can show the price and the
        availability next to the result instead of a bare link. Prices are
        stored in kopecks and quoted here in roubles, which is what
        schema.org expects.
      */}
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger -- JSON-LD has to be inlined; the payload is our own catalog data
        dangerouslySetInnerHTML={{ __html: JSON.stringify(menuItemJsonLd(product)).replace(/</g, '\\u003c') }}
      />
      <ProductDetail product={product} />
    </>
  );
}

function menuItemJsonLd(product: Product) {
  const offers = product.sizes.length
    ? product.sizes.map((size) => ({
        '@type': 'Offer',
        name: size.label,
        price: kopecksToRubles(size.price),
        priceCurrency: 'RUB',
        availability: 'https://schema.org/InStock',
      }))
    : [
        {
          '@type': 'Offer',
          price: kopecksToRubles(product.priceFrom),
          priceCurrency: 'RUB',
          availability: 'https://schema.org/InStock',
        },
      ];

  return {
    '@context': 'https://schema.org',
    '@type': 'MenuItem',
    name: product.name,
    description: product.description ?? undefined,
    image: product.imageUrl ?? undefined,
    url: `${SITE_URL}/menu/${product.slug}`,
    suitableForDiet: product.isVegetarian ? 'https://schema.org/VegetarianDiet' : undefined,
    offers,
  };
}
