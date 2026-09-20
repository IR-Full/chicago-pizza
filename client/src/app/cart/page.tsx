'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ShoppingCart } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError } from '@/shared/api/api-client';
import { useFormatters } from '@/shared/lib/use-formatters';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { Skeleton } from '@/shared/ui/skeleton';
import { CartLineItem } from '@/entities/cart/ui/cart-line-item';
import { useCart, useRemoveCartItem, useUpdateCartItem } from '@/entities/cart/queries';
import { useCurrentUser } from '@/entities/user/queries';

export default function CartPage() {
  const t = useTranslations('cart');
  const te = useTranslations('errors');
  const { formatPrice } = useFormatters();

  const { data: user, isLoading: userLoading } = useCurrentUser();
  const { data: cart, isLoading } = useCart();
  const updateItem = useUpdateCartItem();
  const removeItem = useRemoveCartItem();

  const mutating = updateItem.isPending || removeItem.isPending;

  async function handleQuantity(lineId: string, quantity: number) {
    try {
      await updateItem.mutateAsync({ lineId, quantity });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Не удалось обновить корзину');
    }
  }

  async function handleRemove(lineId: string) {
    try {
      await removeItem.mutateAsync(lineId);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Не удалось удалить товар');
    }
  }

  if (userLoading || (user && isLoading)) {
    return (
      <div className="container max-w-3xl space-y-4 py-10">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!user) {
    return (
      <EmptyState
        title={te('loginRequired')}
        action={
          <Button asChild>
            <Link href="/login?redirect=/cart">{te('loginRequired')}</Link>
          </Button>
        }
      />
    );
  }

  if (!cart || cart.lines.length === 0) {
    return (
      <EmptyState
        title={t('empty')}
        hint={t('emptyHint')}
        action={
          <Button asChild>
            <Link href="/menu">{t('goToMenu')}</Link>
          </Button>
        }
      />
    );
  }

  // Priced by the server: the client never decides what delivery costs.
  const deliveryFee = cart.deliveryFee;

  return (
    <div className="container max-w-3xl space-y-6 py-10">
      <h1 className="text-[clamp(1.75rem,3.4vw,2.5rem)] font-black">{t('title')}</h1>

      {cart.removed.length ? (
        // The server drops lines whose product went off sale instead of
        // failing the whole cart — say so, or the total looks wrong.
        <div role="status" className="rounded-2xl bg-brand-100 p-4 text-sm text-brand-900">
          <p className="font-semibold">{t('removedTitle')}</p>
          <p className="mt-1 text-brand-900/80">{t('removedHint')}</p>
          <ul className="mt-2 list-disc pl-5">
            {cart.removed.map((item, index) => (
              <li key={`${item.productName}-${index}`}>
                {item.productName} — {item.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Card>
        <CardContent className="p-4 sm:p-6">
          <ul>
            {cart.lines.map((line) => (
              <CartLineItem
                key={line.lineId}
                line={line}
                disabled={mutating}
                onQuantityChange={handleQuantity}
                onRemove={handleRemove}
              />
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 p-4 sm:p-6">
          <Row label={t('subtotal')} value={formatPrice(cart.subtotal)} />
          <Row
            label={t('delivery')}
            value={deliveryFee === 0 ? t('freeDelivery') : formatPrice(deliveryFee)}
          />
          <div className="flex items-center justify-between border-t pt-3 text-lg font-bold">
            <span>{t('subtotal')}</span>
            <span>{formatPrice(cart.total)}</span>
          </div>

          <Button size="lg" className="mt-2 w-full" asChild>
            <Link href="/checkout">{t('checkout')}</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action: React.ReactNode;
}) {
  return (
    <div className="container flex flex-col items-center gap-4 py-24 text-center">
      <ShoppingCart className="h-12 w-12 text-muted-foreground" aria-hidden />
      <h1 className="text-2xl font-black">{title}</h1>
      {hint ? <p className="text-muted-foreground">{hint}</p> : null}
      {action}
    </div>
  );
}
