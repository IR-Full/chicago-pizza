'use client';

import { Check, ChefHat, ClipboardCheck, PackageCheck, Truck, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { OrderStatus } from '@/shared/api/types';
import { cn } from '@/shared/lib/cn';

const FLOW = ['CREATED', 'ACCEPTED', 'PREPARING', 'ON_DELIVERY', 'DELIVERED'] as const;

type FlowStatus = (typeof FLOW)[number];

const ICONS: Record<FlowStatus, typeof Check> = {
  CREATED: ClipboardCheck,
  ACCEPTED: Check,
  PREPARING: ChefHat,
  ON_DELIVERY: Truck,
  DELIVERED: PackageCheck,
};

export function OrderStatusTracker({ status }: { status: OrderStatus }) {
  const t = useTranslations('orders.status');

  if (status === 'CANCELLED') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-destructive">
        <XCircle className="h-5 w-5" aria-hidden />
        <span className="font-medium">{t('CANCELLED')}</span>
      </div>
    );
  }

  const currentIndex = FLOW.indexOf(status as FlowStatus);

  return (
    <ol className="flex items-start justify-between gap-1">
      {FLOW.map((step, index) => {
        const Icon = ICONS[step];
        const isDone = index <= currentIndex;
        const isCurrent = index === currentIndex;

        return (
          <li key={step} className="flex flex-1 flex-col items-center gap-2 text-center">
            <div className="flex w-full items-center">
              {/* Connector to the previous step */}
              <span
                className={cn(
                  'h-0.5 flex-1',
                  index === 0 ? 'invisible' : index <= currentIndex ? 'bg-primary' : 'bg-border',
                )}
              />
              <span
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                  isDone ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground',
                  isCurrent && 'ring-4 ring-primary/20',
                )}
                aria-current={isCurrent ? 'step' : undefined}
              >
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <span
                className={cn(
                  'h-0.5 flex-1',
                  index === FLOW.length - 1 ? 'invisible' : index < currentIndex ? 'bg-primary' : 'bg-border',
                )}
              />
            </div>
            <span className={cn('text-xs leading-tight', isDone ? 'font-medium' : 'text-muted-foreground')}>
              {t(step)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
