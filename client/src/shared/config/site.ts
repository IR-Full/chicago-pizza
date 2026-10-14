/**
 * The site's own public address.
 *
 * Canonical links, `sitemap.xml` and structured data all have to name an
 * absolute URL, and none of them can derive it from the request: a sitemap is
 * generated once and a canonical that points at `localhost` is worse than no
 * canonical at all. Set `NEXT_PUBLIC_SITE_URL` for the deployment.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'http://localhost:3000').replace(
  /\/+$/,
  '',
);

/**
 * 2GIS MapGL key, or an empty string.
 *
 * Optional the same way the Web Push keys are: without it the address form
 * stays as it was — typed, with no pin — and the CSP keeps the tighter policy
 * instead of carrying holes for a map nobody loads.
 */
export const MAP_KEY = process.env.NEXT_PUBLIC_2GIS_MAP_KEY ?? '';

/** The pizzeria itself, as search engines want to be told about it. */
export const BUSINESS = {
  name: 'Chicago Pizza',
  city: 'Махачкала',
  region: 'Республика Дагестан',
  country: 'RU',
  cuisine: ['Пицца', 'Итальянская кухня'],
} as const;
