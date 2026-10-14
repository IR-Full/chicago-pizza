import { BUSINESS, SITE_URL } from '@/shared/config/site';
import { CLOSE_MINUTE, formatOpeningMinute, OPEN_MINUTE } from '@/shared/config/delivery';

/**
 * Demo contacts are not a verified business identity. Publish WebSite data
 * until the owner confirms the real location, phone and opening hours.
 */
export function RestaurantJsonLd({
  address,
  phone,
  openMinute = OPEN_MINUTE,
  closeMinute = CLOSE_MINUTE,
  verified = false,
}: {
  address: string;
  phone: string;
  openMinute?: number;
  closeMinute?: number;
  verified?: boolean;
}) {
  const data = verified
    ? {
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
      }
    : {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#website`,
        name: 'Чикаго Пицца',
        alternateName: BUSINESS.name,
        url: SITE_URL,
      };

  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger -- JSON-LD must be inlined; the payload is our own copy
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  );
}
