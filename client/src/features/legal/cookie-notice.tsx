'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@/shared/ui/button';

const DISMISSED_KEY = 'cookie-notice-dismissed';

/**
 * A notice, not a consent gate — and the difference is deliberate.
 *
 * The site sets three cookies: two httpOnly session tokens and the chosen
 * language. All three are strictly necessary for a function the visitor
 * asked for, so neither 152-ФЗ nor the ePrivacy rules require prior consent
 * for them; a modal demanding "accept" for cookies that will be set anyway is
 * theatre. There are no analytics or advertising cookies to ask about. If any
 * are ever added, this component is the wrong shape for them and should be
 * replaced by a real consent manager that blocks them until a choice is made.
 *
 * The dismissal lives in localStorage rather than a cookie, so reading it
 * cannot itself become the thing being consented to.
 */
export function CookieNotice() {
  const t = useTranslations('legal');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Read after mount: the server has no localStorage, and rendering the
    // banner on the server would flash it for people who dismissed it.
    try {
      setVisible(window.localStorage.getItem(DISMISSED_KEY) !== '1');
    } catch {
      // Private mode with storage disabled — show it, it is only a notice.
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // Nothing to do; the notice simply returns next visit.
    }
    setVisible(false);
  };

  return (
    <div
      role="region"
      aria-label={t('cookieTitle')}
      className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-2xl rounded-card border bg-card/95 p-4 shadow-lg backdrop-blur sm:inset-x-6"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {t('cookieBody')}{' '}
          <Link href="/privacy" className="font-medium text-primary hover:underline">
            {t('cookieLink')}
          </Link>
        </p>
        <Button size="sm" onClick={dismiss} className="shrink-0">
          {t('cookieDismiss')}
        </Button>
      </div>
    </div>
  );
}
