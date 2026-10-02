'use client';

import { useParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { Order, OrderStatus } from '@/shared/api/types';
import { WS_EVENTS } from '@/shared/api/socket';
import { useSocketEvent, useSocketRoom } from '@/shared/lib/use-socket-event';
import { orderNumber } from '@/shared/lib/format';
import { useFormatters } from '@/shared/lib/use-formatters';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Skeleton } from '@/shared/ui/skeleton';
import { Badge } from '@/shared/ui/badge';
import { orderKeys, useCancelOrder, useOrder, useOrderPayment, useStartPayment } from '@/entities/order/queries';
import { OrderStatusTracker } from '@/entities/order/ui/order-status-tracker';
import { OrderReviewForm } from '@/features/order-review/ui/order-review-form';
import { ApiError } from '@/shared/api/api-client';

/**
 * Mirrors `CUSTOMER_CANCELLABLE_STATUSES` on the server. The cut-off is the
 * oven: before it nothing has been spent but time.
 */
const CANCELLABLE: OrderStatus[] = ['CREATED', 'ACCEPTED'];

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const orderId = params.id;

  const t = useTranslations('orders');
  const tstatus = useTranslations('orders.status');
  const tcart = useTranslations('cart');
  const tcheckout = useTranslations('checkout');
  const { formatDateTime, formatPrice } = useFormatters();
  const qc = useQueryClient();

  const { data: order, isLoading } = useOrder(orderId);
  const cancelOrder = useCancelOrder();
  const startPayment = useStartPayment();

  // Only for an order that was placed to be paid online; everything else has
  // nothing to poll for.
  const { data: payment } = useOrderPayment(orderId, order?.paymentMethod === 'ONLINE');

  async function pay() {
    try {
      const { confirmationUrl } = await startPayment.mutateAsync(orderId);
      window.location.assign(confirmationUrl);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : tcheckout('paymentFailed'));
    }
  }

  async function cancel() {
    if (!window.confirm(t('cancelConfirm'))) return;
    try {
      await cancelOrder.mutateAsync(orderId);
      toast.success(t('cancelled'));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Не удалось отменить заказ');
    }
  }

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

      {/*
        The customer comes back from the bank before the provider's
        notification necessarily does, so this polls — a page still saying
        "awaiting payment" after they have paid reads as a lost payment.
      */}
      {payment?.required && payment.status !== 'SUCCEEDED' ? (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <div>
              <p className="font-semibold">
                {payment.status === 'CANCELLED'
                  ? tcheckout('paymentCancelled')
                  : tcheckout('awaitingPayment')}
              </p>
              <p className="text-xs text-muted-foreground">{tcheckout('onlineNote')}</p>
            </div>
            <Button className="ml-auto" loading={startPayment.isPending} onClick={pay}>
              {tcheckout('payNow')}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="space-y-4 p-6">
          <OrderStatusTracker status={order.status} />

          {CANCELLABLE.includes(order.status) ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
              <p className="text-xs text-muted-foreground">{t('cancelHint')}</p>
              <Button variant="outline" size="sm" onClick={cancel} loading={cancelOrder.isPending}>
                {t('cancel')}
              </Button>
            </div>
          ) : null}
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
                    {[item.variantName, item.sizeLabel, item.quantity > 1 ? `× ${item.quantity}` : null]
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
