'use client';

import { useId, useState } from 'react';
import { cn } from '@/shared/lib/cn';

export interface ColumnPoint {
  /** Axis label, already formatted for reading. */
  label: string;
  value: number;
  /** What the tooltip says. Falls back to the formatted value. */
  detail?: string;
}

/**
 * Rounds an axis maximum up to a number a person would say out loud.
 *
 * Ticks exist to carry the values that are not directly labelled, so "1 500"
 * is useful where "1 473" is noise.
 */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const steps = [1, 2, 2.5, 5, 10];
  return magnitude * (steps.find((step) => value <= magnitude * step) ?? 10);
}

/**
 * A single-series column chart.
 *
 * One series, so there is no legend: the heading above the chart already names
 * what is plotted, and a box with one swatch would only restate it. Columns
 * grow from one baseline, are capped so the band keeps some air, and are
 * separated by a gap in the surface colour rather than by a stroke — a border
 * would add ink that is not data.
 *
 * The mark colour is stepped per theme rather than flipped: `brand-600` is
 * validated against the light surface, `brand-500` against the dark one.
 */
export function ColumnChart({
  points,
  formatValue,
  maxBarWidth = 24,
  className,
  tableLabel,
  valueLabel,
  peakLabel,
}: {
  points: ColumnPoint[];
  formatValue: (value: number) => string;
  maxBarWidth?: number;
  className?: string;
  /** Column heading for the table view — the same data, readable by anything. */
  tableLabel: string;
  valueLabel: string;
  /** Names the one directly-labelled value, so it is not read as a stray tick. */
  peakLabel: string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const tableId = useId();

  if (!points.length) return null;

  const top = niceMax(Math.max(...points.map((point) => point.value)));
  const ticks = [top, top / 2, 0];
  // Labelled directly, because it is the one value the story is about; every
  // other column is carried by the axis and the tooltip.
  const peak = points.reduce((best, point, index) => (point.value > points[best].value ? index : best), 0);

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex gap-3">
        {/* Ticks round to numbers a person would say out loud. */}
        <div className="flex h-44 w-12 shrink-0 flex-col justify-between text-right text-[11px] text-muted-foreground">
          {ticks.map((tick) => (
            <span key={tick}>{formatValue(tick)}</span>
          ))}
        </div>

        <div className="relative min-w-0 flex-1">
          {/* Hairline, solid, one step off the surface: present but recessive. */}
          <div aria-hidden className="absolute inset-0 flex h-44 flex-col justify-between">
            {ticks.map((tick) => (
              <div key={tick} className="h-px w-full bg-border" />
            ))}
          </div>

          {/*
            No `items-end` here: it would shrink each `li` to its content and
            leave the slot's `h-full` resolving against nothing, so a
            percentage-height bar would come out at zero. The columns sit on
            the baseline because the slot is a full-height flex column with
            `justify-end`.
          */}
          <ul className="relative flex h-44 gap-[2px]" role="presentation">
            {points.map((point, index) => (
              <li
                key={point.label}
                className="flex h-full min-w-0 flex-1 justify-center"
                onMouseEnter={() => setHovered(index)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(index)}
                onBlur={() => setHovered(null)}
              >
                <div
                  // The hit target is the whole column slot, not the drawn bar:
                  // a 3px-tall bar for a quiet day is impossible to hover.
                  tabIndex={0}
                  role="img"
                  aria-label={`${point.label}: ${point.detail ?? formatValue(point.value)}`}
                  style={{ maxWidth: maxBarWidth }}
                  className="flex h-full w-full cursor-default flex-col justify-end outline-none"
                >
                  <div
                    style={{ height: `${Math.max((point.value / top) * 100, point.value > 0 ? 2 : 0)}%` }}
                    className={cn(
                      // Rounded at the data end, square at the baseline.
                      'w-full rounded-t-[4px] bg-brand-600 transition-opacity dark:bg-brand-500',
                      hovered !== null && hovered !== index && 'opacity-60',
                    )}
                  />
                </div>
              </li>
            ))}
          </ul>

          {/*
            Only the extreme is labelled — a number on every column goes
            unread. Named, so it reads as "the best day was X" rather than as
            a label that has slipped off its bar.
          */}
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {peakLabel}: {points[peak].label} · {formatValue(points[peak].value)}
          </p>

          {hovered !== null ? (
            <p
              role="status"
              className="mt-1 rounded-md bg-card px-2 py-1 text-xs font-medium shadow-sm"
            >
              {points[hovered].label} · {points[hovered].detail ?? formatValue(points[hovered].value)}
            </p>
          ) : null}
        </div>
      </div>

      {/*
        The same numbers, reachable without reading a chart at all — for a
        screen reader, for print, and for anyone who wants the figures.
      */}
      <details>
        <summary className="cursor-pointer text-xs text-muted-foreground">{tableLabel}</summary>
        <table className="mt-2 w-full text-sm" id={tableId}>
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="font-normal">{tableLabel}</th>
              <th className="font-normal">{valueLabel}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.label} className="border-t">
                <td className="py-1">{point.label}</td>
                <td className="py-1">{point.detail ?? formatValue(point.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
