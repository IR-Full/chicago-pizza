'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { DiscountType, Promocode } from '@/shared/api/types';
import { ApiError } from '@/shared/api/api-client';
import { rublesToKopecks } from '@/shared/lib/format';
import { useFormatters } from '@/shared/lib/use-formatters';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { FormField } from '@/shared/ui/form-field';
import { Input } from '@/shared/ui/input';
import { Skeleton } from '@/shared/ui/skeleton';
import { adminApi } from '@/features/admin/api';

const promocodesKey = ['admin', 'promocodes'] as const;

export default function AdminPromocodesPage() {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const { formatPrice, formatDateTime } = useFormatters();
  const qc = useQueryClient();

  const [code, setCode] = useState('');
  const [discountType, setDiscountType] = useState<DiscountType>('PERCENT');
  const [discountValue, setDiscountValue] = useState('10');
  const [minOrderRub, setMinOrderRub] = useState('0');

  const {
    data: promocodes,
    isLoading,
    isFetching,
    error: listError,
    refetch,
  } = useQuery({
    queryKey: promocodesKey,
    queryFn: adminApi.listPromocodes,
  });

  const create = useMutation({
    mutationFn: adminApi.createPromocode,
    onSuccess: () => {
      setCode('');
      return qc.invalidateQueries({ queryKey: promocodesKey });
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : t('promocodeCreateFailed')),
  });

  const update = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      adminApi.updatePromocode(id, { isActive }),
    onSuccess: async (saved) => {
      qc.setQueryData<Promocode[]>(promocodesKey, (current) =>
        current?.map((promo) => (promo.id === saved.id ? saved : promo)),
      );
      await qc.invalidateQueries({ queryKey: promocodesKey });
      toast.success(saved.isActive ? t('promocodeActivated') : t('promocodeDeactivated'));
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : t('promocodeUpdateFailed')),
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!code.trim()) return;

    create.mutate({
      code: code.trim().toUpperCase(),
      discountType,
      // Percent codes take a plain number; fixed ones are stored in kopecks.
      discountValue:
        discountType === 'PERCENT' ? Number(discountValue) : rublesToKopecks(Number(discountValue)),
      minOrderAmount: rublesToKopecks(Number(minOrderRub)),
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-4">
          <form onSubmit={submit} className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <FormField label={t('code')} htmlFor="code">
              <Input
                id="code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="SUMMER20"
              />
            </FormField>

            <FormField label={t('discount')} htmlFor="discountType">
              <select
                id="discountType"
                value={discountType}
                onChange={(e) => setDiscountType(e.target.value as DiscountType)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="PERCENT">%</option>
                <option value="FIXED">₽</option>
              </select>
            </FormField>

            <FormField label={discountType === 'PERCENT' ? '%' : '₽'} htmlFor="discountValue">
              <Input
                id="discountValue"
                type="number"
                min={1}
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
              />
            </FormField>

            <div className="flex min-w-0 flex-wrap items-end gap-2">
              <FormField className="flex-1" label={t('promocodeMinOrder')} htmlFor="minOrder">
                <Input
                  id="minOrder"
                  type="number"
                  min={0}
                  value={minOrderRub}
                  onChange={(e) => setMinOrderRub(e.target.value)}
                />
              </FormField>
              <Button type="submit" loading={create.isPending}>
                {t('createPromocode')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {listError ? (
        <div role="alert" className="space-y-3">
          <p>{listError instanceof ApiError ? listError.message : t('promocodeLoadFailed')}</p>
          <Button variant="outline" loading={isFetching} onClick={() => refetch()}>
            {tc('retry')}
          </Button>
        </div>
      ) : null}

      {isLoading ? (
        <Skeleton className="h-48" />
      ) : promocodes?.length ? (
        <div className="space-y-2">
          {promocodes.map((promo) => {
            const expired = promo.expiresAt !== null && new Date(promo.expiresAt).getTime() <= Date.now();
            const exhausted = promo.maxUses !== null && promo.usedCount >= promo.maxUses;
            return (
              <Card key={promo.id}>
                <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm">
                  <code className="break-all font-bold tracking-wider">{promo.code}</code>
                  <span>
                    {promo.discountType === 'PERCENT'
                      ? `−${promo.discountValue}%`
                      : `−${formatPrice(promo.discountValue)}`}
                  </span>
                  {promo.minOrderAmount > 0 ? (
                    <span className="text-muted-foreground">
                      {t('promocodeFrom', { amount: formatPrice(promo.minOrderAmount) })}
                    </span>
                  ) : null}
                  <span className="text-muted-foreground">
                    {t('used')}: {promo.usedCount}
                    {promo.maxUses !== null ? ` / ${promo.maxUses}` : ''}
                  </span>
                  {promo.expiresAt ? (
                    <span className="text-muted-foreground">
                      {t('promocodeExpires', { date: formatDateTime(promo.expiresAt) })}
                    </span>
                  ) : null}
                  <div className="flex flex-wrap gap-1.5">
                    {!promo.isActive ? <Badge variant="secondary">{t('inactive')}</Badge> : null}
                    {expired ? <Badge variant="warning">{t('promocodeExpired')}</Badge> : null}
                    {exhausted ? <Badge variant="warning">{t('promocodeExhausted')}</Badge> : null}
                    {promo.isActive && !expired && !exhausted ? (
                      <Badge variant="success">{t('active')}</Badge>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="ml-auto"
                    disabled={update.isPending}
                    loading={update.isPending && update.variables?.id === promo.id}
                    aria-busy={update.isPending && update.variables?.id === promo.id}
                    aria-label={t(promo.isActive ? 'deactivatePromocode' : 'activatePromocode', {
                      code: promo.code,
                    })}
                    onClick={() => update.mutate({ id: promo.id, isActive: !promo.isActive })}
                  >
                    {t(promo.isActive ? 'deactivatePromocodeAction' : 'activatePromocodeAction')}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : !listError ? (
        <p className="py-6 text-muted-foreground">{t('promocodeEmpty')}</p>
      ) : null}
    </div>
  );
}
