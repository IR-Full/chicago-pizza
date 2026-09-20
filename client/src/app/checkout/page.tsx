'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Info, Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { AppliedPromocode, DeliveryType, PaymentMethod } from '@/shared/api/types';
import { ApiError } from '@/shared/api/api-client';
import { useFormatters } from '@/shared/lib/use-formatters';
import {
  CLOSING_HOUR,
  isWithinOpeningHours,
  MIN_SCHEDULE_LEAD_MINUTES,
  OPENING_HOUR,
} from '@/shared/config/delivery';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { FormField } from '@/shared/ui/form-field';
import { Input } from '@/shared/ui/input';
import { Textarea } from '@/shared/ui/textarea';
import { Skeleton } from '@/shared/ui/skeleton';
import { useCart, useCheckPromocode } from '@/entities/cart/queries';
import { useAddresses, useCurrentUser, useLoyalty } from '@/entities/user/queries';
import { useCheckout } from '@/entities/order/queries';
import { AddressForm } from '@/features/checkout/ui/address-form';

/**
 * `datetime-local` speaks local time, but `toISOString()` speaks UTC — using
 * it for `min` shifted the earliest slot by the timezone offset (three hours
 * in Makhachkala).
 */
function toLocalInputValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export default function CheckoutPage() {
  const t = useTranslations('checkout');
  const tcart = useTranslations('cart');
  const te = useTranslations('errors');
  const { formatPrice } = useFormatters();
  const router = useRouter();

  const { data: user, isLoading: userLoading } = useCurrentUser();
  const { data: cart, isLoading: cartLoading } = useCart();
  const { data: addresses = [] } = useAddresses();
  const { data: loyalty } = useLoyalty();
  const checkPromocode = useCheckPromocode();
  const checkout = useCheckout();

  const [addressId, setAddressId] = useState<string>('');
  const [showAddressForm, setShowAddressForm] = useState(false);
  const [deliveryType, setDeliveryType] = useState<DeliveryType>('ASAP');
  const [scheduledAt, setScheduledAt] = useState('');
  const [comment, setComment] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH_ON_DELIVERY');
  const [promocodeInput, setPromocodeInput] = useState('');
  const [appliedPromo, setAppliedPromo] = useState<AppliedPromocode | null>(null);
  const [redeemPoints, setRedeemPoints] = useState(0);

  // Preselect the default address (or the only one) so the common case is
  // one click.
  useEffect(() => {
    if (addressId || !addresses.length) return;
    setAddressId((addresses.find((a) => a.isDefault) ?? addresses[0]).id);
  }, [addresses, addressId]);

  if (userLoading || cartLoading) {
    return (
      <div className="container max-w-3xl space-y-4 py-10">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container flex flex-col items-center gap-4 py-24 text-center">
        <p>{te('loginRequired')}</p>
        <Button asChild>
          <Link href="/login?redirect=/checkout">{te('loginRequired')}</Link>
        </Button>
      </div>
    );
  }

  if (!cart || !cart.lines.length) {
    return (
      <div className="container flex flex-col items-center gap-4 py-24 text-center">
        <p>{tcart('empty')}</p>
        <Button asChild>
          <Link href="/menu">{tcart('goToMenu')}</Link>
        </Button>
      </div>
    );
  }

  // Priced by the server: the client never decides what delivery costs.
  const deliveryFee = cart.deliveryFee;
  const promoDiscount = appliedPromo?.discount ?? 0;
  const maxRedeemable = Math.min(
    loyalty?.points ?? 0,
    Math.floor(Math.max(0, cart.subtotal - promoDiscount) / 100),
  );
  const pointsDiscount = Math.min(redeemPoints, maxRedeemable) * 100;
  const total = Math.max(0, cart.subtotal - promoDiscount - pointsDiscount) + deliveryFee;

  async function applyPromocode() {
    if (!promocodeInput.trim()) return;
    try {
      const result = await checkPromocode.mutateAsync(promocodeInput.trim());
      setAppliedPromo(result);
      toast.success(tcart('promocodeApplied'));
    } catch (error) {
      setAppliedPromo(null);
      toast.error(error instanceof ApiError ? error.message : 'Промокод не применён');
    }
  }

  async function placeOrder() {
    if (!addressId) {
      toast.error(t('chooseAddress'));
      return;
    }
    if (deliveryType === 'SCHEDULED' && !scheduledAt) {
      toast.error(t('scheduledAt'));
      return;
    }
    // The server rejects a slot outside opening hours; catching it here saves
    // the customer a round-trip and an error in a language they did not pick.
    if (deliveryType === 'SCHEDULED' && !isWithinOpeningHours(new Date(scheduledAt))) {
      toast.error(t('outsideHours', { from: OPENING_HOUR, to: CLOSING_HOUR }));
      return;
    }

    try {
      const order = await checkout.mutateAsync({
        addressId,
        deliveryType,
        scheduledAt: deliveryType === 'SCHEDULED' ? new Date(scheduledAt).toISOString() : undefined,
        comment: comment || undefined,
        promocode: appliedPromo?.code,
        redeemPoints: redeemPoints > 0 ? Math.min(redeemPoints, maxRedeemable) : undefined,
        paymentMethod,
      });
      toast.success(t('orderPlaced'));
      router.push(`/orders/${order.id}`);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Не удалось оформить заказ');
    }
  }

  return (
    <div className="container max-w-3xl space-y-6 py-10">
      <h1 className="text-[clamp(1.75rem,3.4vw,2.5rem)] font-black">{t('title')}</h1>

      {/* Address */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('address')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {addresses.length ? (
            <div className="space-y-2">
              {addresses.map((address) => (
                <button
                  key={address.id}
                  type="button"
                  onClick={() => setAddressId(address.id)}
                  className={cn(
                    'w-full rounded-md border p-3 text-left text-sm transition-colors',
                    addressId === address.id ? 'border-primary bg-primary/5' : 'hover:bg-accent',
                  )}
                >
                  <span className="font-medium">{address.title}</span>
                  <span className="block text-muted-foreground">
                    {address.city}, {address.street}, {address.house}
                    {address.apartment ? `, кв. ${address.apartment}` : ''}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('chooseAddress')}</p>
          )}

          {showAddressForm ? (
            <AddressForm
              onCreated={(id) => {
                setAddressId(id);
                setShowAddressForm(false);
              }}
            />
          ) : (
            <Button variant="outline" size="sm" className="gap-2" onClick={() => setShowAddressForm(true)}>
              <Plus className="h-4 w-4" />
              {t('newAddress')}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Delivery time */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('deliveryTime')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <OptionButton active={deliveryType === 'ASAP'} onClick={() => setDeliveryType('ASAP')}>
              {t('asap')}
            </OptionButton>
            <OptionButton active={deliveryType === 'SCHEDULED'} onClick={() => setDeliveryType('SCHEDULED')}>
              {t('scheduled')}
            </OptionButton>
          </div>

          {deliveryType === 'SCHEDULED' ? (
            <FormField label={t('scheduledAt')} htmlFor="scheduledAt">
              <Input
                id="scheduledAt"
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                // The API rejects anything sooner than half an hour out.
                min={toLocalInputValue(new Date(Date.now() + (MIN_SCHEDULE_LEAD_MINUTES + 1) * 60_000))}
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                {t('hoursHint', { from: OPENING_HOUR, to: CLOSING_HOUR })}
              </p>
            </FormField>
          ) : null}

          <FormField label={t('comment')} htmlFor="comment">
            <Textarea id="comment" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
          </FormField>
        </CardContent>
      </Card>

      {/* Payment */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('payment')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <OptionButton
              active={paymentMethod === 'CASH_ON_DELIVERY'}
              onClick={() => setPaymentMethod('CASH_ON_DELIVERY')}
            >
              {t('cashOnDelivery')}
            </OptionButton>
            <OptionButton
              active={paymentMethod === 'CARD_ON_DELIVERY'}
              onClick={() => setPaymentMethod('CARD_ON_DELIVERY')}
            >
              {t('cardOnDelivery')}
            </OptionButton>
          </div>
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {t('paymentNote')}
          </p>
        </CardContent>
      </Card>

      {/* Discounts */}
      <Card>
        <CardContent className="space-y-4 p-4 sm:p-6">
          <div className="flex gap-2">
            <Input
              value={promocodeInput}
              onChange={(e) => setPromocodeInput(e.target.value.toUpperCase())}
              placeholder={tcart('promocode')}
              aria-label={tcart('promocode')}
            />
            <Button variant="outline" onClick={applyPromocode} loading={checkPromocode.isPending}>
              {tcart('applyPromocode')}
            </Button>
          </div>

          {maxRedeemable > 0 ? (
            <FormField
              label={t('usePoints')}
              htmlFor="points"
              hint={t('availablePoints', { points: loyalty?.points ?? 0 })}
            >
              <Input
                id="points"
                type="number"
                min={0}
                max={maxRedeemable}
                value={redeemPoints || ''}
                onChange={(e) => setRedeemPoints(Math.min(Number(e.target.value) || 0, maxRedeemable))}
              />
            </FormField>
          ) : null}

          <div className="space-y-2 border-t pt-4 text-sm">
            <SummaryRow label={tcart('subtotal')} value={formatPrice(cart.subtotal)} />
            {promoDiscount > 0 ? (
              <SummaryRow label={tcart('discount')} value={`−${formatPrice(promoDiscount)}`} accent />
            ) : null}
            {pointsDiscount > 0 ? (
              <SummaryRow label={t('usePoints')} value={`−${formatPrice(pointsDiscount)}`} accent />
            ) : null}
            <SummaryRow
              label={tcart('delivery')}
              value={deliveryFee === 0 ? tcart('freeDelivery') : formatPrice(deliveryFee)}
            />
            <div className="flex items-center justify-between border-t pt-3 text-lg font-bold">
              <span>{tcart('subtotal')}</span>
              <span>{formatPrice(total)}</span>
            </div>
          </div>

          <Button size="lg" className="w-full" onClick={placeOrder} loading={checkout.isPending}>
            {t('placeOrder')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function OptionButton({
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
        'rounded-md border px-4 py-2.5 text-sm font-medium transition-colors',
        active ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent',
      )}
    >
      {children}
    </button>
  );
}

function SummaryRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn(accent && 'text-sage-700')}>{value}</span>
    </div>
  );
}
