import { BUSINESS, SITE_URL } from '@/shared/config/site';
import { CLOSING_HOUR, OPENING_HOUR } from '@/shared/config/delivery';

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
  openingHour = OPENING_HOUR,
  closingHour = CLOSING_HOUR,
}: {
  address: string;
  phone: string;
  openingHour?: number;
  closingHour?: number;
}) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    name: BUSINESS.name,
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
      opens: `${String(openingHour).padStart(2, '0')}:00`,
      closes: `${String(closingHour).padStart(2, '0')}:00`,
    },
    areaServed: { '@type': 'City', name: BUSINESS.city },
  };

  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger -- JSON-LD must be inlined; the payload is our own copy
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
