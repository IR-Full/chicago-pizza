'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { cn } from '@/shared/lib/cn';
import { LOCALE_COOKIE, locales, type Locale } from '@/shared/i18n/config';

/** RU / EN as a pair of small pills, the way the design system shows it. */
export function LocaleSwitcher() {
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function switchTo(target: Locale) {
    if (target === locale) return;
    // next-intl reads the locale from this cookie on the server; refreshing
    // re-renders every Server Component with the new messages.
    document.cookie = `${LOCALE_COOKIE}=${target};path=/;max-age=${60 * 60 * 24 * 365};samesite=lax`;
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex items-center gap-1">
      {locales.map((option) => (
        <button
          key={option}
          type="button"
          disabled={isPending}
          onClick={() => switchTo(option)}
          aria-pressed={option === locale}
          aria-label={`Switch language to ${option.toUpperCase()}`}
          className={cn(
            'rounded-full px-3 py-1.5 font-heading text-xs font-black uppercase transition-colors disabled:opacity-50',
            option === locale
              ? 'bg-primary text-primary-foreground'
              : 'text-foreground/70 hover:bg-foreground/[0.07]',
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
