import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/shared/config/site';
import { productApi } from '@/entities/product/api';

/** Rebuilt hourly: the menu changes with the season, not with the minute. */
export const revalidate = 3600;

/** How many items to list. The menu is a few dozen; the cap is a guard rail. */
const MAX_PRODUCTS = 500;

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
