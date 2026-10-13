'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useFormatters } from '@/shared/lib/use-formatters';
import { cn } from '@/shared/lib/cn';
import { BarList } from '@/shared/ui/bar-list';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { ColumnChart } from '@/shared/ui/column-chart';
import { Skeleton } from '@/shared/ui/skeleton';
import { useBranches } from '@/entities/product/queries';
import { adminApi } from '@/features/admin/api';

/** The windows an owner actually asks about. */
const WINDOWS = [7, 30, 90] as const;

/**
 * The owner's report.
 *
 * Revenue leads as the one hero figure; everything else is a stat tile or a
 * single-series chart. Two measures of different scale never share an axis —
 * revenue and order count are two charts, not one with two y-scales.
 */
export default function AdminAnalyticsPage() {
  const t = useTranslations('admin');
  const { formatPrice } = useFormatters();

  const [days, setDays] = useState<number>(30);
  const [branchId, setBranchId] = useState<string>('');

  const { data: branches = [] } = useBranches();

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'analytics', days, branchId],
    queryFn: () => adminApi.analytics(days, branchId || undefined),
  });

  const percent = (value: number) => `${Math.round(value * 100)}%`;

  return (
    <div className="space-y-5">
      {/* Filters in one row above the charts. */}
      <div className="flex flex-wrap items-center gap-2">
        {WINDOWS.map((window) => (
          <Chip key={window} active={days === window} onClick={() => setDays(window)}>
            {t('lastDays', { days: window })}
          </Chip>
        ))}

        <span aria-hidden className="mx-1 h-5 w-px bg-border" />

        <Chip active={branchId === ''} onClick={() => setBranchId('')}>
          {t('allBranches')}
        </Chip>
        {branches.map((branch) => (
          <Chip key={branch.id} active={branchId === branch.id} onClick={() => setBranchId(branch.id)}>
            {branch.name}
          </Chip>
        ))}
      </div>

      {isLoading || !data ? (
        <Skeleton className="h-96" />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {/* The one hero figure on the page. */}
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">{t('revenue')}</p>
                <p className="font-heading text-[clamp(2rem,4vw,3rem)] font-black leading-tight">
                  {formatPrice(data.revenue)}
                </p>
              </CardContent>
            </Card>

            <StatTile label={t('ordersDelivered')} value={String(data.orders)} />
            <StatTile label={t('averageCheque')} value={formatPrice(data.averageCheque)} />
            <StatTile
              label={t('cancellationRate')}
              value={percent(data.cancellationRate)}
              // Not a status colour: this is a measure, and reserving the
              // status palette for states keeps it meaningful.
              hint={t('ofSettledOrders')}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('revenueByDay')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ColumnChart
                points={data.revenueByDay.map((day) => ({
                  label: day.date.slice(5),
                  value: day.revenue,
                  detail: `${formatPrice(day.revenue)} · ${t('ordersShort', { count: day.orders })}`,
                }))}
                formatValue={formatPrice}
                tableLabel={t('day')}
                valueLabel={t('revenue')}
                peakLabel={t('bestDay')}
              />
            </CardContent>
          </Card>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('topProducts')}</CardTitle>
              </CardHeader>
              <CardContent>
                <BarList
                  rows={data.topProducts.map((product) => ({
                    label: product.productName,
                    value: product.revenue,
                    note: t('piecesShort', { count: product.quantity }),
                  }))}
                  formatValue={formatPrice}
                  emptyLabel={t('noData')}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('howReceived')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <BarList
                  rows={[
                    { label: t('deliveryOrder'), value: data.fulfillment.delivery },
                    { label: t('pickupOrder'), value: data.fulfillment.pickup },
                  ]}
                  formatValue={(value) => String(value)}
                  emptyLabel={t('noData')}
                />

                <div className="space-y-1 border-t pt-3">
                  <p className="text-sm font-semibold">{t('promocodeUse')}</p>
                  {data.promocodes.length ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-muted-foreground">
                            <th className="font-normal">{t('promocode')}</th>
                            <th className="font-normal">{t('uses')}</th>
                            <th className="font-normal">{t('discountGiven')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.promocodes.map((promocode) => (
                            <tr key={promocode.code} className="border-t">
                              <td className="py-1 font-medium">{promocode.code}</td>
                              <td className="py-1">{promocode.uses}</td>
                              <td className="py-1">{formatPrice(promocode.discount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    // A code that was issued and never redeemed is not listed:
                    // the honest answer to "did it work" is that it did nothing.
                    <p className="text-sm text-muted-foreground">{t('noPromocodeUse')}</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold">{value}</p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-full border px-3 py-1 text-sm transition-colors',
        active ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent',
      )}
    >
      {children}
    </button>
  );
}
