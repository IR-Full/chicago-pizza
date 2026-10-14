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
import { SITE_URL } from '@/shared/config/site';
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
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Чикаго Пицца (Chicago Pizza) — доставка пиццы в Махачкале',
    template: '%s | Чикаго Пицца',
  },
  description:
    'Меню Чикаго Пицца в Махачкале: пиццы 45, 50 и 60 см, закуски и напитки. Выбор начинки, пицца 50/50, доставка и самовывоз.',
  keywords: ['Чикаго Пицца', 'пицца', 'Махачкала', 'доставка пиццы', 'Chicago Pizza', 'заказать пиццу'],
  manifest: '/manifest.webmanifest',
  openGraph: {
    type: 'website',
    locale: 'ru_RU',
    siteName: 'Chicago Pizza',
    title: 'Чикаго Пицца — меню и доставка в Махачкале',
    description: 'Пиццы 45, 50 и 60 см, закуски и напитки. Доставка и самовывоз.',
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
