import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/shared/config/site';

/**
 * Nothing behind a login has any business in an index — and a crawler that
 * wanders into `/checkout` or `/admin` spends its budget on pages that will
 * only ever answer "please sign in".
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/cart', '/checkout', '/orders', '/profile', '/support', '/verify-email', '/reset-password'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
