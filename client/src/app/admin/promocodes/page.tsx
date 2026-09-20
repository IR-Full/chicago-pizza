'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { DiscountType } from '@/shared/api/types';
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

export default function AdminPromocodesPage() {
  const t = useTranslations('admin');
  const { formatPrice } = useFormatters();
  const qc = useQueryClient();

  const [code, setCode] = useState('');
  const [discountType, setDiscountType] = useState<DiscountType>('PERCENT');
  const [discountValue, setDiscountValue] = useState('10');
  const [minOrderRub, setMinOrderRub] = useState('0');

  const { data: promocodes, isLoading } = useQuery({
    queryKey: ['admin', 'promocodes'],
    queryFn: adminApi.listPromocodes,
  });

  const create = useMutation({
    mutationFn: adminApi.createPromocode,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'promocodes'] });
      setCode('');
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Не удалось создать промокод'),
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
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-4">
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

            <div className="flex items-end gap-2">
              <FormField className="flex-1" label="Мин. заказ, ₽" htmlFor="minOrder">
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

      {isLoading ? (
        <Skeleton className="h-48" />
      ) : (
        <div className="space-y-2">
          {promocodes?.map((promo) => (
            <Card key={promo.id}>
              <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm">
                <code className="font-bold tracking-wider">{promo.code}</code>
                <span>
                  {promo.discountType === 'PERCENT'
                    ? `−${promo.discountValue}%`
                    : `−${formatPrice(promo.discountValue)}`}
                </span>
                {promo.minOrderAmount > 0 ? (
                  <span className="text-muted-foreground">от {formatPrice(promo.minOrderAmount)}</span>
                ) : null}
                <span className="text-muted-foreground">
                  {t('used')}: {promo.usedCount}
                  {promo.maxUses ? ` / ${promo.maxUses}` : ''}
                </span>
                <Badge variant={promo.isActive ? 'success' : 'secondary'} className="ml-auto">
                  {promo.isActive ? t('active') : t('inactive')}
                </Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
