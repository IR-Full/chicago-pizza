'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { Order, OrderStatus } from '@/shared/api/types';
import { ApiError } from '@/shared/api/api-client';
import { WS_EVENTS } from '@/shared/api/socket';
import { useSocketEvent } from '@/shared/lib/use-socket-event';
import { formatDateTime, formatPrice, orderNumber } from '@/shared/lib/format';
import { cn } from '@/shared/lib/cn';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { Skeleton } from '@/shared/ui/skeleton';
import { adminApi } from '@/features/admin/api';

/** Mirrors the server-side state machine so the UI only offers legal moves. */
const NEXT_STATUSES: Record<OrderStatus, OrderStatus[]> = {
  CREATED: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['ON_DELIVERY', 'CANCELLED'],
  ON_DELIVERY: ['DELIVERED', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: [],
};

const STATUS_FILTERS: (OrderStatus | 'ALL')[] = [
  'ALL',
  'CREATED',
  'ACCEPTED',
  'PREPARING',
  'ON_DELIVERY',
  'DELIVERED',
];

export default function AdminOrdersPage() {
  const t = useTranslations('admin');
  const tstatus = useTranslations('orders.status');
  const qc = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'ALL'>('ALL');

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'orders', statusFilter],
    queryFn: () => adminApi.listOrders(1, statusFilter === 'ALL' ? undefined : statusFilter),
    refetchInterval: 60_000,
  });

  const updateStatus = useMutation({
    mutationFn: ({ orderId, status }: { orderId: string; status: OrderStatus }) =>
      adminApi.updateOrderStatus(orderId, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'orders'] }),
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Не удалось сменить статус'),
  });

  // Staff sockets join the `staff` room, so every order change lands here
  // live — no polling needed to see a new order arrive.
  useSocketEvent<{ orderId: string; status: OrderStatus }>(WS_EVENTS.ORDER_STATUS, () => {
    qc.invalidateQueries({ queryKey: ['admin', 'orders'] });
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => setStatusFilter(status)}
            className={cn(
              'rounded-full border px-3 py-1 text-sm transition-colors',
              statusFilter === status
                ? 'border-primary bg-primary text-primary-foreground'
                : 'hover:bg-accent',
            )}
          >
            {status === 'ALL' ? t('orders') : tstatus(status)}
          </button>
        ))}
      </div>

      {isLoading ? (
        <Skeleton className="h-64" />
      ) : data?.items.length ? (
        <div className="space-y-3">
          {data.items.map((order) => (
            <OrderRow
              key={order.id}
              order={order}
              onStatusChange={(status) => updateStatus.mutate({ orderId: order.id, status })}
              isUpdating={updateStatus.isPending && updateStatus.variables?.orderId === order.id}
            />
          ))}
        </div>
      ) : (
        <p className="py-16 text-center text-muted-foreground">—</p>
      )}
    </div>
  );
}

function OrderRow({
  order,
  onStatusChange,
  isUpdating,
}: {
  order: Order;
  onStatusChange: (status: OrderStatus) => void;
  isUpdating: boolean;
}) {
  const t = useTranslations('admin');
  const tstatus = useTranslations('orders.status');

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-semibold">№{orderNumber(order.id)}</span>
          <Badge variant={order.status === 'DELIVERED' ? 'success' : 'secondary'}>
            {tstatus(order.status)}
          </Badge>
          <span className="text-sm text-muted-foreground">{formatDateTime(order.createdAt)}</span>
          <span className="ml-auto font-bold">{formatPrice(order.total)}</span>
        </div>

        <div className="grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
          <p>
            {t('customer')}: {order.user?.firstName ?? '—'} {order.user?.phone ?? ''}
          </p>
          {order.address ? (
            <p>
              {order.address.street}, {order.address.house}
              {order.address.apartment ? `, кв. ${order.address.apartment}` : ''}
            </p>
          ) : null}
        </div>

        <p className="text-sm">
          {order.items.map((item) => `${item.productName}${item.quantity > 1 ? ` ×${item.quantity}` : ''}`).join(', ')}
        </p>

        {NEXT_STATUSES[order.status].length ? (
          <div className="flex flex-wrap gap-2">
            {NEXT_STATUSES[order.status].map((next) => (
              <Button
                key={next}
                size="sm"
                variant={next === 'CANCELLED' ? 'outline' : 'default'}
                disabled={isUpdating}
                onClick={() => onStatusChange(next)}
              >
                {tstatus(next)}
              </Button>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
