'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ApiError } from '@/shared/api/api-client';
import { formatDateTime, formatPrice, orderNumber } from '@/shared/lib/format';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { Skeleton } from '@/shared/ui/skeleton';
import { useOrders, useRepeatOrder } from '@/entities/order/queries';
import { useCurrentUser } from '@/entities/user/queries';

export default function OrdersPage() {
  const t = useTranslations('orders');
  const tstatus = useTranslations('orders.status');
  const te = useTranslations('errors');
  const router = useRouter();

  const { data: user, isLoading: userLoading } = useCurrentUser();
  const { data, isLoading } = useOrders(1);
  const repeat = useRepeatOrder();

  async function handleRepeat(orderId: string) {
    try {
      await repeat.mutateAsync(orderId);
      router.push('/cart');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Не удалось повторить заказ');
    }
  }

  if (userLoading || (user && isLoading)) {
    return (
      <div className="container max-w-3xl space-y-4 py-10">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container flex flex-col items-center gap-4 py-24 text-center">
        <p>{te('loginRequired')}</p>
        <Button asChild>
          <Link href="/login?redirect=/orders">{te('loginRequired')}</Link>
        </Button>
      </div>
    );
  }

  if (!data?.items.length) {
    return <div className="container py-24 text-center text-muted-foreground">{t('empty')}</div>;
  }

  return (
    <div className="container max-w-3xl space-y-4 py-10">
      <h1 className="text-[clamp(1.75rem,3.4vw,2.5rem)] font-black">{t('title')}</h1>

      {data.items.map((order) => (
        <Card key={order.id}>
          <CardContent className="space-y-3 p-4 sm:p-6">
            <div className="flex flex-wrap items-center gap-3">
              <Link href={`/orders/${order.id}`} className="font-semibold hover:underline">
                {t('orderNumber', { number: orderNumber(order.id) })}
              </Link>
              <Badge variant={order.status === 'DELIVERED' ? 'success' : 'secondary'}>
                {tstatus(order.status)}
              </Badge>
              <span className="ml-auto text-sm text-muted-foreground">{formatDateTime(order.createdAt)}</span>
            </div>

            <p className="text-sm text-muted-foreground">
              {order.items.map((item) => `${item.productName}${item.quantity > 1 ? ` ×${item.quantity}` : ''}`).join(', ')}
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold">{formatPrice(order.total)}</span>
              <div className="ml-auto flex gap-2">
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/orders/${order.id}`}>{t('track')}</Link>
                </Button>
                <Button
                  size="sm"
                  onClick={() => handleRepeat(order.id)}
                  loading={repeat.isPending && repeat.variables === order.id}
                >
                  {t('repeat')}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
