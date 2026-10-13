'use client';

import { cn } from '@/shared/lib/cn';

export interface BarRow {
  label: string;
  value: number;
  /** Shown after the value — "12 шт", say. */
  note?: string;
}

/**
 * A ranked list of magnitudes: name on the left, bar and value on the right.
 *
 * Horizontal because the labels are product names, and a column chart would
 * either rotate them or truncate them. One series, so no legend; the value
 * rides the tip of each bar, which is the one place a number per row earns its
 * keep — the rows are few and the reader is comparing them directly.
 */
export function BarList({
  rows,
  formatValue,
  emptyLabel,
  className,
}: {
  rows: BarRow[];
  formatValue: (value: number) => string;
  emptyLabel: string;
  className?: string;
}) {
  if (!rows.length) {
    return <p className={cn('text-sm text-muted-foreground', className)}>{emptyLabel}</p>;
  }

  const top = Math.max(...rows.map((row) => row.value), 1);

  return (
    <ul className={cn('space-y-2', className)}>
      {rows.map((row) => (
        <li key={row.label} className="space-y-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate">{row.label}</span>
            <span className="shrink-0 text-muted-foreground">
              {formatValue(row.value)}
              {row.note ? ` · ${row.note}` : ''}
            </span>
          </div>
          {/* The track is a lighter step of the same ramp, so the pair reads as
              one object rather than as two colours. */}
          <div className="h-2 w-full overflow-hidden rounded-full bg-brand-100 dark:bg-brand-100">
            <div
              style={{ width: `${Math.max((row.value / top) * 100, 2)}%` }}
              className="h-full rounded-full bg-brand-600 dark:bg-brand-500"
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
