'use client';

import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './button';
import { cn } from '@/shared/lib/cn';

interface PaginationProps {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
  getHref?: (page: number) => string;
  className?: string;
}

/**
 * The API has always paged; the UI used to ask for page 1 and stop, so
 * anything past the first screenful was unreachable. A single page of results
 * needs no controls at all, so the component renders nothing in that case.
 */
export function Pagination({ page, totalPages, onChange, getHref, className }: PaginationProps) {
  const t = useTranslations('common');

  if (totalPages <= 1) return null;

  const current = Math.min(Math.max(page, 1), totalPages);
  const control = (target: number, label: string, icon: React.ReactNode) => {
    const disabled = target < 1 || target > totalPages;
    if (getHref && !disabled) {
      return (
        <Button variant="outline" size="sm" asChild>
          <a
            href={getHref(target)}
            aria-label={label}
            onClick={(event) => {
              if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
                return;
              event.preventDefault();
              onChange(target);
            }}
          >
            {icon}
          </a>
        </Button>
      );
    }
    return (
      <Button
        variant="outline"
        size="sm"
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(target)}
      >
        {icon}
      </Button>
    );
  };

  return (
    <nav aria-label={t('pagination')} className={cn('flex items-center justify-center gap-3', className)}>
      {control(current - 1, t('previousPage'), <ChevronLeft className="h-4 w-4" />)}

      <span aria-live="polite" className="text-sm text-muted-foreground">
        {t('pageOf', { page: current, total: totalPages })}
      </span>

      {control(current + 1, t('nextPage'), <ChevronRight className="h-4 w-4" />)}
    </nav>
  );
}
