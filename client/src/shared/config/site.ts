/**
 * The site's own public address.
 *
 * Canonical links, `sitemap.xml` and structured data all have to name an
 * absolute URL, and none of them can derive it from the request: a sitemap is
 * generated once and a canonical that points at `localhost` is worse than no
 * canonical at all. Set `NEXT_PUBLIC_SITE_URL` for the deployment.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');

/** The pizzeria itself, as search engines want to be told about it. */
export const BUSINESS = {
  name: 'Chicago Pizza',
  city: 'Махачкала',
  region: 'Республика Дагестан',
  country: 'RU',
  cuisine: ['Пицца', 'Итальянская кухня'],
} as const;
