import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/shared/i18n/request.ts');

/**
 * One id per build, shared between Next and the service worker. CI can pin it
 * to the commit sha; locally the timestamp is enough to bust the SW cache.
 */
const buildId = process.env.BUILD_ID ?? `dev-${Date.now().toString(36)}`;

const isDev = process.env.NODE_ENV !== 'production';

/**
 * The gateway sets a CSP with Helmet, but that only ever covered JSON
 * responses — the HTML comes from here, so the policy has to be declared here
 * too. Browser code talks to the API over these origins; in production they
 * are same-origin through Nginx, in development they are a separate port.
 */
const apiOrigins = [process.env.NEXT_PUBLIC_API_URL, process.env.NEXT_PUBLIC_WS_URL]
  .filter(Boolean)
  .flatMap((value) => {
    try {
      const { origin } = new URL(value);
      // Socket.IO upgrades to the ws(s) scheme, which connect-src matches
      // separately from http(s).
      return [origin, origin.replace(/^http/, 'ws')];
    } catch {
      return [];
    }
  });

const csp = [
  "default-src 'self'",
  // Next inlines its bootstrap and flight payload scripts; a nonce would need
  // per-request middleware, which would make every page dynamic.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  // next/font self-hosts the Google fonts at build time, so no external host.
  "font-src 'self' data:",
  ["connect-src 'self'", ...new Set(apiOrigins)].join(' '),
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  generateBuildId: () => buildId,
  // The service worker is a static file, so it cannot be compiled against
  // anything — it reads the id off its own registration URL instead.
  env: { NEXT_PUBLIC_BUILD_ID: buildId },
  // Produces a minimal standalone server bundle for the Docker image.
  output: 'standalone',
  images: {
    // The optimizer is switched off deliberately, not by oversight.
    //
    // Nothing in the app uses `next/image` — product pictures are plain
    // `<img>` tags — so `/_next/image` was a live route nobody called. With
    // `hostname: '**'` it also accepted any https URL, which made it an open
    // image proxy: a stranger could push their traffic through this server.
    // It is the same route that carries the AVIF decoding RCE unpatched in
    // the 14.x line, so turning it off removes both problems at once.
    //
    // Bringing images back: publish them from one known host, list it in
    // `remotePatterns`, and drop this flag.
    unoptimized: true,
  },
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        // Only the CSP: nosniff, Referrer-Policy, X-Frame-Options and
        // Permissions-Policy are set once at the edge (infra/nginx), and
        // emitting them twice makes the pair ambiguous to the browser.
        headers: [{ key: 'Content-Security-Policy', value: csp }],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
