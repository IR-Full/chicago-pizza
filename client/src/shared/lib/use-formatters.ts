'use client';

import { useLocale } from 'next-intl';
import { useMemo } from 'react';
import { formatDateTime, formatPrice, formatTime } from './format';

/**
 * Prices and dates have to follow the language the visitor picked, not the
 * language the code was written in. The pure helpers in `./format` take a
 * locale; this hook binds them to the active one so client components cannot
 * forget to pass it.
 *
 * Server components have no hooks — they read the locale with `getLocale()`
 * from `next-intl/server` and call the helpers directly.
 */
export function useFormatters() {
  const locale = useLocale();

  return useMemo(
    () => ({
      formatPrice: (kopecks: number) => formatPrice(kopecks, locale),
      formatDateTime: (value: string | Date) => formatDateTime(value, locale),
      formatTime: (value: string | Date) => formatTime(value, locale),
    }),
    [locale],
  );
}
