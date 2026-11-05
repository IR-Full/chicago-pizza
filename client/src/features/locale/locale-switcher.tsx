'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { cn } from '@/shared/lib/cn';
import { LOCALE_COOKIE, locales, type Locale } from '@/shared/i18n/config';

export function LocaleSwitcher({ onPoster = false }: { onPoster?: boolean }) {
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
    <div className="flex items-center">
      {locales.map((option) => (
        <button
          key={option}
          type="button"
          disabled={isPending}
          onClick={() => switchTo(option)}
          aria-pressed={option === locale}
          aria-label={`Switch language to ${option.toUpperCase()}`}
          className={cn(
            'grid min-h-11 min-w-11 place-items-center rounded-md px-2 text-xs font-bold uppercase underline-offset-4 transition-colors hover:underline aria-pressed:underline disabled:opacity-50',
            onPoster
              ? 'hover:bg-white/10 focus-visible:ring-[color:var(--poster-foreground)] focus-visible:ring-offset-[color:var(--poster-background)]'
              : 'hover:bg-foreground/[0.07]',
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
