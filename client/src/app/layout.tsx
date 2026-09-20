import type { Metadata, Viewport } from 'next';
import { Nunito, Nunito_Sans } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { Header } from '@/widgets/header/header';
import { Footer } from '@/widgets/footer/footer';
import { SupportChatWidget } from '@/widgets/support-chat/support-chat-widget';
import { ServiceWorkerRegistrar } from '@/features/pwa/service-worker-registrar';
import { CookieNotice } from '@/features/legal/cookie-notice';
import { Providers } from './providers';
import './globals.css';

// Caprasimo/Figtree from the design system carry no Cyrillic — Nunito and
// Nunito Sans are the nearest rounded, warm substitutes that do, so the
// system's voice survives in Russian.
const heading = Nunito({
  subsets: ['latin', 'cyrillic'],
  weight: ['700', '800', '900'],
  variable: '--font-heading',
  display: 'swap',
  fallback: ['system-ui', 'sans-serif'],
});

const body = Nunito_Sans({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '600', '700'],
  variable: '--font-body',
  display: 'swap',
  // Next has no metric overrides for Nunito Sans; ask for the plain fallback
  // instead of letting it warn on every build.
  adjustFontFallback: false,
  fallback: ['system-ui', 'sans-serif'],
});

export const metadata: Metadata = {
  title: {
    default: 'Chicago Pizza — доставка пиццы в Махачкале',
    template: '%s | Chicago Pizza',
  },
  description:
    'Пицца по-чикагски с доставкой по Махачкале за 45 минут. Конструктор пиццы 50/50, три размера, свежие ингредиенты.',
  keywords: ['пицца', 'Махачкала', 'доставка пиццы', 'Chicago Pizza', 'заказать пиццу'],
  manifest: '/manifest.webmanifest',
  openGraph: {
    type: 'website',
    locale: 'ru_RU',
    siteName: 'Chicago Pizza',
    title: 'Chicago Pizza — доставка пиццы в Махачкале',
    description: 'Пицца по-чикагски с доставкой по Махачкале за 45 минут.',
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5ead8' },
    { media: '(prefers-color-scheme: dark)', color: '#1f1c19' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning className={`${heading.variable} ${body.variable}`}>
      <body className="min-h-dvh">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Providers>
            <div className="flex min-h-dvh flex-col">
              <Header />
              <main className="flex-1">{children}</main>
              <Footer />
            </div>
            <SupportChatWidget />
            <ServiceWorkerRegistrar />
            <CookieNotice />
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
