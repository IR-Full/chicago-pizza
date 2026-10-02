'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Volume2, VolumeX } from 'lucide-react';
import { toast } from 'sonner';
import type { Order, OrderStatus } from '@/shared/api/types';
import { ApiError } from '@/shared/api/api-client';
import { WS_EVENTS } from '@/shared/api/socket';
import { useSocketEvent } from '@/shared/lib/use-socket-event';
import { orderNumber } from '@/shared/lib/format';
import { useFormatters } from '@/shared/lib/use-formatters';
import { cn } from '@/shared/lib/cn';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Skeleton } from '@/shared/ui/skeleton';
import { useBranches } from '@/entities/product/queries';
import { useCurrentUser } from '@/entities/user/queries';
import { adminApi } from '@/features/admin/api';
import { movesFor } from '@/features/admin/order-moves';
import { useNewOrderChime } from '@/features/admin/use-new-order-chime';

/** The columns the kitchen works through, left to right. */
const COLUMNS: OrderStatus[] = ['CREATED', 'ACCEPTED', 'PREPARING', 'ON_DELIVERY'];

/**
 * How long an order may sit in one column before the card starts shouting.
 *
 * Per column, because the numbers mean different things: nothing should wait
 * two minutes unacknowledged, while twenty minutes in the oven is normal.
 */
const AMBER_MINUTES: Record<OrderStatus, number> = {
  CREATED: 2,
  ACCEPTED: 5,
  PREPARING: 20,
  ON_DELIVERY: 30,
  DELIVERED: Number.POSITIVE_INFINITY,
  CANCELLED: Number.POSITIVE_INFINITY,
};

/** Past this it is not late, it is a problem. */
const RED_MULTIPLIER = 2;

/** The clock has to move without a refetch, or the timers lie. */
const TICK_MS = 15_000;

/**
 * The kitchen screen.
 *
 * Built for a wall-mounted tablet nobody touches gently: four columns, one
 * obvious action per card, and a timer that turns amber and then red so the
 * screen can be read from the other side of the room. It is not the admin
 * order list with different CSS — that list answers "what happened", this one
 * answers "what is late".
 */
export default function AdminKitchenPage() {
  const t = useTranslations('admin');
  const tstatus = useTranslations('orders.status');
  const qc = useQueryClient();

  const { data: actor } = useCurrentUser();
  const { data: branches = [] } = useBranches();

  const [branchId, setBranchId] = useState<string>('');
  const [soundOn, setSoundOn] = useState(true);
  // Re-renders on a timer so the "waiting for" numbers stay true between
  // refetches.
  const [, setTick] = useState(0);

  const chime = useNewOrderChime(soundOn);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'kitchen', branchId],
    queryFn: () => adminApi.listKitchenOrders(branchId || undefined),
    // A kitchen screen that silently stops updating is worse than no screen;
    // the socket is the fast path and this is the safety net.
    refetchInterval: 30_000,
  });

  // Memoised so the arrival effect below does not re-run on every render: a
  // fresh `[]` each time would ring the chime whenever anything re-rendered.
  const orders = useMemo(() => data?.items ?? [], [data]);

  const updateStatus = useMutation({
    mutationFn: ({ orderId, status }: { orderId: string; status: OrderStatus }) =>
      adminApi.updateOrderStatus(orderId, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'kitchen'] }),
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Не удалось сменить статус'),
  });

  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // Ring only for orders that are actually new to this screen. Comparing ids
  // rather than counting: a delivered order leaving the board would otherwise
  // make the next arrival silent.
  const known = useRef<Set<string> | null>(null);
  useEffect(() => {
    // Before the first response there is nothing to compare against — and the
    // empty list a loading query renders must not become the baseline, or the
    // first real response would ring for every order already on the board.
    if (!data) return;

    const ids = new Set(orders.map((order) => order.id));

    if (known.current === null) {
      // Arriving at a screen with ten orders on it is not ten pieces of news.
      known.current = ids;
      return;
    }

    const arrived = [...ids].some((id) => !known.current!.has(id));
    known.current = ids;
    if (arrived) chime();
  }, [data, orders, chime]);

  useSocketEvent<{ orderId: string; status: OrderStatus }>(WS_EVENTS.ORDER_STATUS, () => {
    qc.invalidateQueries({ queryKey: ['admin', 'kitchen'] });
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <BranchChip active={branchId === ''} onClick={() => setBranchId('')}>
          {t('allBranches')}
        </BranchChip>
        {branches.map((branch) => (
          <BranchChip key={branch.id} active={branchId === branch.id} onClick={() => setBranchId(branch.id)}>
            {branch.name}
          </BranchChip>
        ))}

        <Button
          variant="outline"
          size="sm"
          className="ml-auto gap-2"
          aria-pressed={soundOn}
          onClick={() => setSoundOn((value) => !value)}
        >
          {soundOn ? <Volume2 className="h-4 w-4" aria-hidden /> : <VolumeX className="h-4 w-4" aria-hidden />}
          {soundOn ? t('soundOn') : t('soundOff')}
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-64" />
      ) : orders.length ? (
        <div className="grid gap-3 lg:grid-cols-4">
          {COLUMNS.map((status) => (
            <section key={status} className="space-y-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                {tstatus(status)}
                <Badge variant="secondary">{orders.filter((o) => o.status === status).length}</Badge>
              </h2>

              {orders
                .filter((order) => order.status === status)
                .map((order) => (
                  <KitchenCard
                    key={order.id}
                    order={order}
                    moves={movesFor(order, actor)}
                    isBusy={updateStatus.isPending && updateStatus.variables?.orderId === order.id}
                    onAdvance={(next) => updateStatus.mutate({ orderId: order.id, status: next })}
                  />
                ))}
            </section>
          ))}
        </div>
      ) : (
        <p className="py-16 text-center text-muted-foreground">{t('kitchenEmpty')}</p>
      )}
    </div>
  );
}

/** Minutes the order has spent in the status it is in now. */
function minutesInStatus(order: Order): number {
  // `updatedAt` moves on every status change, so it is the moment this column
  // received the order — no extra query for the history.
  const since = new Date(order.updatedAt ?? order.createdAt).getTime();
  return Math.max(0, Math.floor((Date.now() - since) / 60_000));
}

function KitchenCard({
  order,
  moves,
  isBusy,
  onAdvance,
}: {
  order: Order;
  moves: OrderStatus[];
  isBusy: boolean;
  onAdvance: (status: OrderStatus) => void;
}) {
  const t = useTranslations('admin');
  const tstatus = useTranslations('orders.status');
  const { formatPrice } = useFormatters();

  const waiting = minutesInStatus(order);
  const amber = AMBER_MINUTES[order.status];
  const isLate = waiting >= amber;
  const isVeryLate = waiting >= amber * RED_MULTIPLIER;

  // The next step, not every legal one: a kitchen screen with four buttons per
  // card is a screen where the wrong one gets pressed.
  const next = moves.find((move) => move !== 'CANCELLED');

  return (
    <article
      className={cn(
        'space-y-2 rounded-card border-2 bg-card p-3',
        isVeryLate ? 'border-destructive' : isLate ? 'border-brand-500' : 'border-transparent',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="font-heading text-lg font-black">№{orderNumber(order.id)}</span>
        <span
          className={cn(
            'ml-auto text-sm font-semibold',
            isVeryLate ? 'text-destructive' : isLate ? 'text-brand-700' : 'text-muted-foreground',
          )}
        >
          {t('inStatus', { minutes: waiting })}
        </span>
      </div>

      <ul className="space-y-0.5 text-sm">
        {order.items.map((item) => (
          <li key={item.id}>
            {item.quantity > 1 ? <strong>{item.quantity}× </strong> : null}
            {item.productName}
            {/*
              The flavour, and not in muted grey like the size: this is the
              whole reason variants exist. "Kinza" reached the kitchen with no
              way to tell which of six it was, and the ticket is the only place
              anyone would ever find out.
            */}
            {item.variantName ? <strong className="text-brand-700"> {item.variantName}</strong> : null}
            {item.sizeLabel ? <span className="text-muted-foreground"> · {item.sizeLabel}</span> : null}
          </li>
        ))}
      </ul>

      {order.comment ? <p className="text-sm text-brand-800">{order.comment}</p> : null}

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{order.fulfillment === 'PICKUP' ? t('pickupOrder') : t('deliveryOrder')}</span>
        <span className="ml-auto">{formatPrice(order.total)}</span>
      </div>

      {next ? (
        <Button className="h-12 w-full text-base" disabled={isBusy} onClick={() => onAdvance(next)}>
          {tstatus(next)}
        </Button>
      ) : null}
    </article>
  );
}

function BranchChip({
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
