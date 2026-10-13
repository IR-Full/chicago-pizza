import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/shared/config/site';
import { productApi } from '@/entities/product/api';

/**
 * Rendered per request, not at build time.
 *
 * With a `revalidate` window Next prerenders this during `next build` — where
 * there is no gateway to ask — so the `catch` below baked a sitemap
 * containing only the four static pages and served it for an hour. It looked
 * exactly like a working sitemap.
 *
 * The cost is nothing: `productApi.list` caches its fetch for five minutes, so
 * repeated crawls still hit the catalog once per window.
 */
export const dynamic = 'force-dynamic';

/**
 * How many items to list.
 *
 * 100 because that is the largest page the catalog API accepts — asking for
 * more is a 400, and the `catch` below would have turned that into a sitemap
 * with no products in it at all. The menu is a few dozen items, so one page
 * covers it; past that, this needs to walk the pages.
 */
const MAX_PRODUCTS = 100;

/**
 * Every page worth finding: the public pages, plus one entry per menu item.
 *
 * The product pages are the point — they are the ones that answer a search
 * for a specific pizza, and a crawler has no other way to enumerate them,
 * since the catalog grid paginates behind client-side state.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticPages: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE_URL}/menu`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${SITE_URL}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${SITE_URL}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
  ];

  let products: MetadataRoute.Sitemap = [];
  try {
    const page = await productApi.list({ page: 1, limit: MAX_PRODUCTS });
    products = page.items.map((product) => ({
      url: `${SITE_URL}/menu/${product.slug}`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    }));
  } catch {
    // A sitemap listing the four static pages beats a 500. The catalog will
    // be there on the next revalidation.
  }

  return [...staticPages, ...products];
}
