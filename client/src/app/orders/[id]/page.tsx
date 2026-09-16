'use client';

import { useParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { Order, OrderStatus } from '@/shared/api/types';
import { WS_EVENTS } from '@/shared/api/socket';
import { useSocketEvent, useSocketRoom } from '@/shared/lib/use-socket-event';
import { formatDateTime, formatPrice, orderNumber } from '@/shared/lib/format';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Skeleton } from '@/shared/ui/skeleton';
import { Badge } from '@/shared/ui/badge';
import { orderKeys, useOrder } from '@/entities/order/queries';
import { OrderStatusTracker } from '@/entities/order/ui/order-status-tracker';
import { OrderReviewForm } from '@/features/order-review/ui/order-review-form';

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const orderId = params.id;

  const t = useTranslations('orders');
  const tstatus = useTranslations('orders.status');
  const tcart = useTranslations('cart');
  const tcheckout = useTranslations('checkout');
  const qc = useQueryClient();

  const { data: order, isLoading } = useOrder(orderId);

  // Watch this specific order for live status pushes.
  useSocketRoom('order:subscribe', orderId ? { orderId } : null);

  useSocketEvent<{ orderId: string; status: OrderStatus }>(WS_EVENTS.ORDER_STATUS, (payload) => {
    if (payload.orderId !== orderId) return;

    // Patch the cached order immediately so the tracker moves without a
    // round-trip, then refetch to pick up history and loyalty changes.
    qc.setQueryData<Order>(orderKeys.detail(orderId), (prev) =>
      prev ? { ...prev, status: payload.status } : prev,
    );
    qc.invalidateQueries({ queryKey: orderKeys.detail(orderId) });
    toast.info(tstatus(payload.status));
  });

  if (isLoading) {
    return (
      <div className="container max-w-3xl space-y-4 py-10">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-72" />
      </div>
    );
  }

  if (!order) {
    return <div className="container py-24 text-center text-muted-foreground">{t('empty')}</div>;
  }

  return (
    <div className="container max-w-3xl space-y-6 py-10">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[clamp(1.75rem,3.4vw,2.5rem)] font-black">{t('orderNumber', { number: orderNumber(order.id) })}</h1>
        <Badge variant={order.status === 'DELIVERED' ? 'success' : 'secondary'}>
          {tstatus(order.status)}
        </Badge>
        <span className="ml-auto text-sm text-muted-foreground">{formatDateTime(order.createdAt)}</span>
      </div>

      <Card>
        <CardContent className="p-6">
          <OrderStatusTracker status={order.status} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{tcart('title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="space-y-2">
            {order.items.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-4 text-sm">
                <div>
                  <p className="font-medium">{item.productName}</p>
                  <p className="text-muted-foreground">
                    {[item.sizeLabel, item.quantity > 1 ? `× ${item.quantity}` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <span className="shrink-0 font-medium">{formatPrice(item.totalPrice)}</span>
              </li>
            ))}
          </ul>

          <div className="space-y-1.5 border-t pt-3 text-sm">
            <Row label={tcart('subtotal')} value={formatPrice(order.subtotal)} />
            {order.discount > 0 ? (
              <Row label={tcart('discount')} value={`−${formatPrice(order.discount)}`} />
            ) : null}
            <Row
              label={tcart('delivery')}
              value={order.deliveryFee === 0 ? tcart('freeDelivery') : formatPrice(order.deliveryFee)}
            />
            <div className="flex items-center justify-between border-t pt-2 text-base font-bold">
              <span>{tcart('subtotal')}</span>
              <span>{formatPrice(order.total)}</span>
            </div>
            {order.loyaltyPointsEarned > 0 ? (
              <p className="pt-1 text-xs text-sage-700">
                {t('pointsEarned', { points: order.loyaltyPointsEarned })}
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {order.address ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{tcheckout('address')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-muted-foreground">
            <p>
              {order.address.city}, {order.address.street}, {order.address.house}
              {order.address.apartment ? `, кв. ${order.address.apartment}` : ''}
            </p>
            {order.comment ? <p>{order.comment}</p> : null}
          </CardContent>
        </Card>
      ) : null}

      {order.status === 'DELIVERED' ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('rate')}</CardTitle>
          </CardHeader>
          <CardContent>
            <OrderReviewForm orderId={order.id} existingReview={order.review ?? null} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}
