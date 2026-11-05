'use client';

import Link from 'next/link';
import { ArrowRight, CupSoda, Heart, Pizza, Sandwich } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Product } from '@/shared/api/types';
import { useFormatters } from '@/shared/lib/use-formatters';
import { cn } from '@/shared/lib/cn';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { ProductImage } from '@/shared/ui/product-image';
import { isProductAvailable } from '../availability';

interface ProductCardProps {
  product: Product;
  isFavorite?: boolean;
  onSelect: (product: Product) => void;
  onToggleFavorite?: (product: Product) => void;
  showFavorite?: boolean;
  mobileRow?: boolean;
}

export function ProductCard({
  product,
  isFavorite = false,
  onSelect,
  onToggleFavorite,
  showFavorite = false,
  mobileRow = false,
}: ProductCardProps) {
  const t = useTranslations('catalog');
  const tc = useTranslations('common');
  const { formatPrice } = useFormatters();
  const isPizza = product.type === 'PIZZA';
  // The cached catalog can still list a temporary stop that has already ended.
  const isAvailable = isProductAvailable(product);
  const hasTags = !isAvailable || product.isHalal || product.isNew || product.isSpicy || product.isVegetarian;
  const Placeholder = product.type === 'DRINK' ? CupSoda : product.type === 'SNACK' ? Sandwich : Pizza;

  return (
    <article
      className={cn(
        'group h-full min-w-0 gap-3',
        mobileRow
          ? 'grid grid-cols-[clamp(4.75rem,27vw,7rem)_minmax(0,1fr)] items-center sm:flex sm:flex-col sm:items-stretch'
          : 'flex flex-col',
      )}
    >
      <div className="relative min-w-0">
        <figure
          className={cn(
            'm-0 aspect-square',
            mobileRow ? 'sm:aspect-auto sm:h-[clamp(12rem,25vw,16rem)]' : 'mx-auto w-full max-w-[10.625rem]',
          )}
        >
          {product.imageUrl ? (
            <ProductImage
              src={product.imageUrl}
              alt={product.name}
              sizes={mobileRow ? '(min-width: 640px) 256px, 112px' : '(min-width: 640px) 170px, 140px'}
              className="object-contain motion-safe:transition-transform motion-safe:duration-300 motion-safe:group-hover:scale-[1.025]"
            />
          ) : (
            <div className="grid h-full place-items-center text-muted-foreground" aria-hidden>
              <Placeholder className="h-12 w-12 sm:h-16 sm:w-16" strokeWidth={1.35} />
            </div>
          )}
        </figure>
        {showFavorite && onToggleFavorite ? (
          <button
            type="button"
            onClick={() => onToggleFavorite(product)}
            aria-label={product.name}
            aria-pressed={isFavorite}
            className="absolute right-0 top-0 grid h-11 w-11 place-items-center rounded-md border border-border bg-background transition-colors hover:border-primary hover:text-brand-700"
          >
            <Heart className={cn('h-4 w-4', isFavorite && 'fill-primary text-primary')} aria-hidden />
          </button>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <h3 className="font-heading text-xl font-black uppercase leading-[1.06] [overflow-wrap:anywhere] sm:text-[clamp(1.375rem,2.5vw,1.875rem)]">
          {/* A normal link keeps the product page reachable from the catalog. */}
          <Link
            href={`/menu/${product.slug}`}
            className="transition-colors hover:text-brand-700 focus-visible:text-brand-700"
          >
            {product.name}
          </Link>
        </h3>

        {product.description ? (
          <p className="line-clamp-2 text-[13px] leading-snug text-muted-foreground sm:text-sm sm:leading-relaxed">
            {product.description}
          </p>
        ) : null}

        {hasTags ? (
          <div className="flex flex-wrap gap-1 [&>div]:rounded-sm [&>div]:px-1.5">
            {isAvailable ? null : <Badge variant="warning">{t('soldOut')}</Badge>}
            {product.isHalal ? <Badge variant="success">{t('halal')}</Badge> : null}
            {product.isNew ? <Badge variant="new">{t('new')}</Badge> : null}
            {product.isSpicy ? <Badge variant="outline">{t('spicy')}</Badge> : null}
            {product.isVegetarian ? <Badge variant="secondary">{t('vegetarian')}</Badge> : null}
          </div>
        ) : null}

        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-2">
          <span className="whitespace-nowrap font-heading text-lg font-black tabular-nums text-brand-700 sm:text-xl">
            {isPizza ? <span className="text-xs font-medium">{tc('from')} </span> : null}
            {formatPrice(product.priceFrom)}
          </span>
          <Button
            type="button"
            size="sm"
            className="h-11 gap-1.5 px-3"
            disabled={!isAvailable}
            onClick={() => onSelect(product)}
          >
            {!isAvailable ? t('soldOut') : isPizza ? t('customize') : t('addToCart')}
            {isAvailable ? (
              <ArrowRight className="hidden h-4 w-4 min-[380px]:inline-block" aria-hidden />
            ) : null}
          </Button>
        </div>
      </div>
    </article>
  );
}
