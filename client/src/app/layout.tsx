import type { Metadata, Viewport } from 'next';
import { Golos_Text, Oswald } from 'next/font/google';
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

const heading = Oswald({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-heading',
  display: 'swap',
  fallback: ['Arial Narrow', 'sans-serif'],
});

const body = Golos_Text({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-body',
  display: 'swap',
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
    { media: '(prefers-color-scheme: light)', color: '#faf5ed' },
    { media: '(prefers-color-scheme: dark)', color: '#211e1b' },
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
