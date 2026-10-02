'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ChevronLeft, Heart, Leaf, Flame } from 'lucide-react';
import type { Product } from '@/shared/api/types';
import { useFormatters } from '@/shared/lib/use-formatters';
import { cn } from '@/shared/lib/cn';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { ProductImage } from '@/shared/ui/product-image';
import { useFavorites, useToggleFavorite } from '@/entities/product/queries';
import { useCurrentUser } from '@/entities/user/queries';
import { isProductAvailable } from '@/entities/product/availability';
import { PizzaConstructorDialog } from '@/features/pizza-constructor/ui/pizza-constructor-dialog';

/**
 * A single item, on its own address.
 *
 * The catalog could only ever be browsed as a grid: `GET /api/products/:slug`
 * existed, `useProduct` existed, and nothing rendered either. For a delivery
 * shop that is the expensive kind of missing page — "пицца пепперони
 * махачкала" has nothing to land on, and there is no link to send a customer
 * who asks what is in one.
 *
 * The product itself is fetched on the server and passed in, so the page is
 * complete in the first response; only the constructor below is interactive.
 */
export function ProductDetail({ product }: { product: Product }) {
  const t = useTranslations('catalog');
  const tc = useTranslations('common');
  const { formatPrice, formatTime } = useFormatters();

  const { data: user } = useCurrentUser();
  const { data: favorites = [] } = useFavorites();
  const toggleFavorite = useToggleFavorite();

  const [constructorOpen, setConstructorOpen] = useState(false);

  const isPizza = product.type === 'PIZZA';
  // A stop that has expired must not still read as sold out; see
  // `isProductAvailable`.
  const isAvailable = isProductAvailable(product);
  const isFavorite = favorites.some((favorite) => favorite.id === product.id);
  // Only what is actually in the pizza. There used to be a second list of
  // everything else on the menu, priced as a paid extra — the pizzeria sells
  // no extras, so it went with the rest of that feature.
  const recipe = product.ingredients.filter((ingredient) => ingredient.isDefault);

  return (
    <div className="container max-w-5xl space-y-6 py-[clamp(1.5rem,4vw,3.5rem)]">
      <Link
        href={product.category ? `/menu?category=${product.category.slug}` : '/menu'}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        {product.category?.name ?? t('allCategories')}
      </Link>

      <div className="grid gap-[clamp(1.5rem,4vw,3rem)] md:grid-cols-2 md:items-start">
        <figure className="m-0 mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-full bg-brand-100">
          {product.imageUrl ? (
            // The one product photo that is above the fold on its own page.
            <ProductImage src={product.imageUrl} alt={product.name} sizes="384px" priority />
          ) : (
            <div className="grid h-full w-full place-items-center text-[clamp(4rem,18vw,8rem)]" aria-hidden>
              🍕
            </div>
          )}
        </figure>

        <div className="space-y-5">
          <div className="flex flex-wrap gap-1.5">
            {isAvailable ? null : <Badge variant="warning">{t('soldOut')}</Badge>}
            {product.isHalal ? <Badge variant="success">{t('halal')}</Badge> : null}
            {product.isNew ? <Badge variant="secondary">{t('new')}</Badge> : null}
            {product.isSpicy ? (
              <Badge variant="outline" className="gap-1">
                <Flame className="h-3 w-3" aria-hidden />
                {t('spicy')}
              </Badge>
            ) : null}
            {product.isVegetarian ? (
              <Badge variant="secondary" className="gap-1">
                <Leaf className="h-3 w-3" aria-hidden />
                {t('vegetarian')}
              </Badge>
            ) : null}
          </div>

          <h1 className="font-heading text-[clamp(1.75rem,4vw,2.75rem)] font-black leading-tight">
            {product.name}
          </h1>

          {product.description ? (
            <p className="leading-relaxed text-foreground/75">{product.description}</p>
          ) : null}

          {!isAvailable && product.stoppedUntil ? (
            <p className="text-sm font-medium text-brand-700">
              {t('backAt', { time: formatTime(product.stoppedUntil) })}
            </p>
          ) : null}

          {recipe.length ? (
            <section className="space-y-1.5">
              <h2 className="text-sm font-semibold">{t('composition')}</h2>
              <p className="text-sm text-muted-foreground">
                {recipe.map((ingredient) => ingredient.name).join(', ')}
              </p>
            </section>
          ) : null}

          {/*
            The flavours, listed rather than picked: this page is the one a
            search engine indexes and a customer sends to a friend, and "Kinza —
            шесть вкусов на выбор" is an answer only if the page says which six.
            Choosing still happens in the constructor.
          */}
          {product.variants?.length ? (
            <section className="space-y-1.5">
              <h2 className="text-sm font-semibold">{t('flavours')}</h2>
              <p className="text-sm text-muted-foreground">
                {product.variants.map((variant) => variant.name).join(', ')}
              </p>
            </section>
          ) : null}

          {isPizza && product.sizes.length ? (
            <section className="space-y-1.5">
              <h2 className="text-sm font-semibold">{t('sizes')}</h2>
              <ul className="flex flex-wrap gap-2">
                {product.sizes.map((size) => (
                  <li key={size.id} className="rounded-md border px-3 py-1.5 text-sm text-muted-foreground">
                    {size.label} — {formatPrice(size.price)}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <div className="flex flex-wrap items-center gap-3 border-t pt-5">
            <span className="font-heading text-2xl font-black">
              {isPizza ? (
                <span className="text-sm font-normal text-muted-foreground">{tc('from')} </span>
              ) : null}
              {formatPrice(product.priceFrom)}
            </span>

            <Button
              size="lg"
              className="ml-auto"
              disabled={!isAvailable}
              onClick={() => setConstructorOpen(true)}
            >
              {!isAvailable ? t('soldOut') : isPizza ? t('customize') : t('addToCart')}
            </Button>

            {user ? (
              <Button
                variant="outline"
                size="lg"
                aria-label={t('favorites')}
                aria-pressed={isFavorite}
                onClick={() => toggleFavorite.mutate({ productId: product.id, isFavorite })}
              >
                <Heart className={cn('h-4 w-4', isFavorite && 'fill-primary text-primary')} />
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <PizzaConstructorDialog
        product={constructorOpen ? product : null}
        open={constructorOpen}
        onOpenChange={setConstructorOpen}
      />
    </div>
  );
}
