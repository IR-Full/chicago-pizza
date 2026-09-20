'use client';

import { Minus, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { CartLine } from '@/shared/api/types';
import { useFormatters } from '@/shared/lib/use-formatters';
import { Button } from '@/shared/ui/button';

interface CartLineItemProps {
  line: CartLine;
  onQuantityChange: (lineId: string, quantity: number) => void;
  onRemove: (lineId: string) => void;
  disabled?: boolean;
}

export function CartLineItem({ line, onQuantityChange, onRemove, disabled }: CartLineItemProps) {
  const t = useTranslations('cart');
  const { formatPrice } = useFormatters();

  return (
    <li className="flex gap-4 border-b py-4 last:border-b-0">
      <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-md bg-muted text-3xl" aria-hidden>
        {line.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- arbitrary CDN host
          <img src={line.imageUrl} alt="" className="h-full w-full rounded-md object-cover" />
        ) : (
          '🍕'
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium leading-tight">{line.productName}</p>

        <p className="text-xs text-muted-foreground">
          {[line.sizeLabel, line.doughTypeName ? `${line.doughTypeName} ${t('dough')}` : null]
            .filter(Boolean)
            .join(' · ')}
        </p>

        {line.addedIngredients.length ? (
          <p className="text-xs text-sage-700">
            + {line.addedIngredients.map((i) => i.name).join(', ')}
          </p>
        ) : null}

        {line.removedIngredients.length ? (
          <p className="text-xs text-muted-foreground line-through">
            {line.removedIngredients.map((i) => i.name).join(', ')}
          </p>
        ) : null}

        <div className="flex items-center gap-2 pt-1">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            aria-label="-"
            disabled={disabled}
            onClick={() => onQuantityChange(line.lineId, line.quantity - 1)}
          >
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <span className="w-6 text-center text-sm font-semibold">{line.quantity}</span>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            aria-label="+"
            disabled={disabled}
            onClick={() => onQuantityChange(line.lineId, line.quantity + 1)}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="ml-1 h-8 w-8 text-muted-foreground hover:text-destructive"
            aria-label={t('title')}
            disabled={disabled}
            onClick={() => onRemove(line.lineId)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="shrink-0 text-right">
        <p className="font-semibold">{formatPrice(line.totalPrice)}</p>
        {line.quantity > 1 ? (
          <p className="text-xs text-muted-foreground">{formatPrice(line.unitPrice)} × {line.quantity}</p>
        ) : null}
      </div>
    </li>
  );
}
