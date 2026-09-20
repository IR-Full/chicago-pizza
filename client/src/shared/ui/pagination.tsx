'use client';

import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './button';
import { cn } from '@/shared/lib/cn';

interface PaginationProps {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
  className?: string;
}

/**
 * The API has always paged; the UI used to ask for page 1 and stop, so
 * anything past the first screenful was unreachable. A single page of results
 * needs no controls at all, so the component renders nothing in that case.
 */
export function Pagination({ page, totalPages, onChange, className }: PaginationProps) {
  const t = useTranslations('common');

  if (totalPages <= 1) return null;

  const current = Math.min(Math.max(page, 1), totalPages);

  return (
    <nav aria-label={t('pagination')} className={cn('flex items-center justify-center gap-3', className)}>
      <Button
        variant="outline"
        size="sm"
        aria-label={t('previousPage')}
        disabled={current <= 1}
        onClick={() => onChange(current - 1)}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>

      <span aria-live="polite" className="text-sm text-muted-foreground">
        {t('pageOf', { page: current, total: totalPages })}
      </span>

      <Button
        variant="outline"
        size="sm"
        aria-label={t('nextPage')}
        disabled={current >= totalPages}
        onClick={() => onChange(current + 1)}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </nav>
  );
}
