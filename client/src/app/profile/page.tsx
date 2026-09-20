'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Copy, Heart, MapPin, Star, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { useFormatters } from '@/shared/lib/use-formatters';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Skeleton } from '@/shared/ui/skeleton';
import {
  useAddresses,
  useCurrentUser,
  useDeleteAddress,
  useLoyalty,
  useReferrals,
} from '@/entities/user/queries';
import { useFavorites, useToggleFavorite } from '@/entities/product/queries';
import { ProductCard } from '@/entities/product/ui/product-card';
import { PrivacySection } from '@/features/privacy/ui/privacy-section';
import { PizzaConstructorDialog } from '@/features/pizza-constructor/ui/pizza-constructor-dialog';
import type { Product } from '@/shared/api/types';

export default function ProfilePage() {
  const t = useTranslations('profile');
  const te = useTranslations('errors');
  const tc = useTranslations('common');
  const { formatPrice } = useFormatters();

  const { data: user, isLoading } = useCurrentUser();
  const { data: addresses = [] } = useAddresses();
  const { data: loyalty } = useLoyalty();
  const { data: referrals } = useReferrals();
  const { data: favorites = [] } = useFavorites();
  const deleteAddress = useDeleteAddress();
  const toggleFavorite = useToggleFavorite();

  const [selected, setSelected] = useState<Product | null>(null);

  if (isLoading) {
    return (
      <div className="container max-w-4xl space-y-4 py-10">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container flex flex-col items-center gap-4 py-24 text-center">
        <p>{te('loginRequired')}</p>
        <Button asChild>
          <Link href="/login?redirect=/profile">{te('loginRequired')}</Link>
        </Button>
      </div>
    );
  }

  function copyReferralCode() {
    if (!referrals) return;
    navigator.clipboard.writeText(referrals.referralCode);
    toast.success(t('copied'));
  }

  return (
    <div className="container max-w-4xl space-y-6 py-10">
      <h1 className="text-[clamp(1.75rem,3.4vw,2.5rem)] font-black">{t('title')}</h1>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Personal data */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('personalData')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p className="font-medium">
              {user.firstName} {user.lastName ?? ''}
            </p>
            <p className="text-muted-foreground">{user.email}</p>
            {user.phone ? <p className="text-muted-foreground">{user.phone}</p> : null}
            {!user.isEmailVerified ? (
              <Badge variant="warning" className="mt-2">
                Email не подтверждён
              </Badge>
            ) : null}
          </CardContent>
        </Card>

        {/* Loyalty */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Star className="h-4 w-4 text-brand-600" aria-hidden />
              {t('loyalty')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold">{loyalty?.points ?? 0}</span>
              <span className="text-muted-foreground">{t('points')}</span>
            </div>
            <p>
              <Badge variant="secondary">{loyalty?.level ?? 'BRONZE'}</Badge>{' '}
              <span className="text-muted-foreground">
                {t('cashback', { percent: loyalty?.cashbackPercent ?? 5 })}
              </span>
            </p>
            {loyalty?.nextLevel ? (
              <p className="text-xs text-muted-foreground">
                {t('toNextLevel', {
                  level: loyalty.nextLevel.level,
                  amount: formatPrice(loyalty.nextLevel.remaining),
                })}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* Referrals */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" aria-hidden />
            {t('referrals')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded-md bg-muted px-3 py-2 text-lg font-bold tracking-widest">
              {referrals?.referralCode ?? '—'}
            </code>
            <Button variant="outline" size="sm" className="gap-2" onClick={copyReferralCode}>
              <Copy className="h-4 w-4" />
              {t('yourReferralCode')}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            {t('referralHint', { points: referrals?.bonusPerReferral ?? 300 })}
          </p>
          <div className="flex gap-6 text-sm">
            <span>
              {t('invited')}: <strong>{referrals?.invited ?? 0}</strong>
            </span>
            <span>
              {t('rewarded')}: <strong>{referrals?.rewarded ?? 0}</strong>
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Addresses */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MapPin className="h-4 w-4" aria-hidden />
            {t('addresses')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {addresses.length ? (
            <ul className="space-y-2">
              {addresses.map((address) => (
                <li key={address.id} className="flex items-center gap-3 rounded-md border p-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {address.title}
                      {address.isDefault ? (
                        <Badge variant="secondary" className="ml-2">
                          ★
                        </Badge>
                      ) : null}
                    </p>
                    <p className="truncate text-muted-foreground">
                      {address.city}, {address.street}, {address.house}
                      {address.apartment ? `, кв. ${address.apartment}` : ''}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={tc('delete')}
                    onClick={() => deleteAddress.mutate(address.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t('noAddresses')}</p>
          )}
        </CardContent>
      </Card>

      {/* Favorites */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Heart className="h-4 w-4" aria-hidden />
            {t('favorites')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {favorites.length ? (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {favorites.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  showFavorite
                  isFavorite
                  onSelect={setSelected}
                  onToggleFavorite={(p) => toggleFavorite.mutate({ productId: p.id, isFavorite: true })}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('noFavorites')}</p>
          )}
        </CardContent>
      </Card>

      {/* Sessions, export and erasure — the rights the policy page promises. */}
      <PrivacySection />

      <PizzaConstructorDialog
        product={selected}
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </div>
  );
}
