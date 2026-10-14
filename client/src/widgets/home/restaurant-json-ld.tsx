import { BUSINESS, SITE_URL } from '@/shared/config/site';
import { CLOSE_MINUTE, formatOpeningMinute, OPEN_MINUTE } from '@/shared/config/delivery';

/**
 * Tells search engines what this place actually is.
 *
 * For a local delivery shop this is most of the SEO that matters: it is what
 * fills in the hours, the phone number and the delivery area next to the
 * result, and what a maps or assistant surface reads instead of guessing from
 * the page text.
 */
export function RestaurantJsonLd({
  address,
  phone,
  openMinute = OPEN_MINUTE,
  closeMinute = CLOSE_MINUTE,
}: {
  address: string;
  phone: string;
  openMinute?: number;
  closeMinute?: number;
}) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    name: BUSINESS.name,
    alternateName: 'Чикаго Пицца',
    url: SITE_URL,
    telephone: phone,
    servesCuisine: [...BUSINESS.cuisine],
    priceRange: '₽₽',
    hasMenu: `${SITE_URL}/menu`,
    address: {
      '@type': 'PostalAddress',
      streetAddress: address,
      addressLocality: BUSINESS.city,
      addressRegion: BUSINESS.region,
      addressCountry: BUSINESS.country,
    },
    openingHoursSpecification: {
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
      // schema.org wants HH:MM, and is happy for `closes` to be earlier
      // than `opens` — that is how it spells a kitchen working past midnight.
      opens: formatOpeningMinute(openMinute),
      closes: formatOpeningMinute(closeMinute),
    },
    areaServed: { '@type': 'City', name: BUSINESS.city },
  };

  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger -- JSON-LD must be inlined; the payload is our own copy
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  );
}
