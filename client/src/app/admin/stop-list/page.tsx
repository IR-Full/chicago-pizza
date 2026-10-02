'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { Product } from '@/shared/api/types';
import { ApiError } from '@/shared/api/api-client';
import { useFormatters } from '@/shared/lib/use-formatters';
import { cn } from '@/shared/lib/cn';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { Input } from '@/shared/ui/input';
import { Skeleton } from '@/shared/ui/skeleton';
import { isProductAvailable } from '@/entities/product/availability';
import { useProducts } from '@/entities/product/queries';
import { adminApi } from '@/features/admin/api';

/**
 * How long the kitchen usually needs. Durations, not clock times: staff think
 * in "for an hour" and "till closing", and a time they have to work out at
 * the end of a shift is a time they will get wrong.
 */
const DURATIONS: { minutes: number; label: string }[] = [
  { minutes: 30, label: '30 мин' },
  { minutes: 60, label: '1 ч' },
  { minutes: 180, label: '3 ч' },
  { minutes: 12 * 60, label: 'До завтра' },
];

/** Enough of the menu to find anything by eye; the search narrows the rest. */
const PAGE_SIZE = 100;

/**
 * The stop list: what the kitchen has run out of tonight.
 *
 * Deliberately separate from delisting. Taking a pizza off the menu is a
 * decision about what the shop sells; running out of mozzarella at nine is a
 * fact about this evening, and it has to undo itself — the one thing nobody
 * does at the end of a shift is remember to switch things back on.
 */
export default function AdminStopListPage() {
  const t = useTranslations('catalog');
  const tc = useTranslations('common');
  const { formatTime } = useFormatters();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');

  const { data, isLoading } = useProducts({ limit: PAGE_SIZE, search: search || undefined });
  const products = data?.items ?? [];

  const setStopped = useMutation({
    mutationFn: ({ productId, minutes }: { productId: string; minutes: number }) =>
      adminApi.stopProduct(productId, minutes),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Не удалось изменить стоп-лист'),
  });

  // Same rule the shop front uses: an expired stop is back on sale, whatever
  // the five-minute catalog cache still says.
  const stopped = products.filter((product) => !isProductAvailable(product));
  const onSale = products.filter((product) => isProductAvailable(product));

  return (
    <div className="space-y-6">
      <Input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={t('searchPlaceholder')}
        aria-label={t('searchPlaceholder')}
      />

      {isLoading ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground">{t('stopList')}</h2>
            {stopped.length ? (
              stopped.map((product) => (
                <StopRow
                  key={product.id}
                  product={product}
                  isBusy={setStopped.isPending && setStopped.variables?.productId === product.id}
                  onChange={(minutes) => setStopped.mutate({ productId: product.id, minutes })}
                  note={
                    product.stoppedUntil
                      ? t('stopped', { time: formatTime(product.stoppedUntil) })
                      : undefined
                  }
                />
              ))
            ) : (
              <p className="text-sm text-muted-foreground">{t('nothingStopped')}</p>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground">{tc('all')}</h2>
            {onSale.length ? (
              onSale.map((product) => (
                <StopRow
                  key={product.id}
                  product={product}
                  isBusy={setStopped.isPending && setStopped.variables?.productId === product.id}
                  onChange={(minutes) => setStopped.mutate({ productId: product.id, minutes })}
                />
              ))
            ) : (
              <p className="text-sm text-muted-foreground">{tc('nothingFound')}</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function StopRow({
  product,
  note,
  isBusy,
  onChange,
}: {
  product: Product;
  note?: string;
  isBusy: boolean;
  onChange: (minutes: number) => void;
}) {
  const t = useTranslations('catalog');
  const isStopped = !isProductAvailable(product);

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-3 p-3">
        <span className={cn('font-medium', isStopped && 'text-muted-foreground line-through')}>
          {product.name}
        </span>
        {note ? <Badge variant="warning">{note}</Badge> : null}

        <div className="ml-auto flex flex-wrap gap-2">
          {isStopped ? (
            <Button size="sm" variant="default" disabled={isBusy} onClick={() => onChange(0)}>
              {t('resume')}
            </Button>
          ) : (
            <>
              <span className="self-center text-xs text-muted-foreground">{t('stopFor')}</span>
              {DURATIONS.map((duration) => (
                <Button
                  key={duration.minutes}
                  size="sm"
                  variant="outline"
                  disabled={isBusy}
                  onClick={() => onChange(duration.minutes)}
                >
                  {duration.label}
                </Button>
              ))}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
