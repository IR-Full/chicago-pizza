'use client';

import { Heart } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Product } from '@/shared/api/types';
import { formatPrice } from '@/shared/lib/format';
import { cn } from '@/shared/lib/cn';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';

interface ProductCardProps {
  product: Product;
  isFavorite?: boolean;
  onSelect: (product: Product) => void;
  onToggleFavorite?: (product: Product) => void;
  showFavorite?: boolean;
}

export function ProductCard({
  product,
  isFavorite = false,
  onSelect,
  onToggleFavorite,
  showFavorite = false,
}: ProductCardProps) {
  const t = useTranslations('catalog');
  const tc = useTranslations('common');
  const isPizza = product.type === 'PIZZA';

  return (
    <article className="group relative flex h-full flex-col gap-3 rounded-card bg-card p-5 text-card-foreground shadow-sm transition-shadow hover:shadow-md">
      {showFavorite && onToggleFavorite ? (
        <button
          type="button"
          onClick={() => onToggleFavorite(product)}
          aria-label={product.name}
          aria-pressed={isFavorite}
          className="absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-full bg-background/70 backdrop-blur transition-colors hover:bg-background"
        >
          <Heart className={cn('h-4 w-4', isFavorite && 'fill-primary text-primary')} />
        </button>
      ) : null}

      {/* The plate: every item is served as a circle, photo or not. */}
      <figure className="m-0 mx-auto aspect-square w-[clamp(7.5rem,60%,10.625rem)] overflow-hidden rounded-full bg-brand-100">
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- product images come from arbitrary CDN hosts
          <img
            src={product.imageUrl}
            alt={product.name}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-[clamp(2.5rem,9vw,4rem)]" aria-hidden>
            🍕
          </div>
        )}
      </figure>

      {/* Always rendered, tags or not, so titles line up across a row of cards. */}
      <div className="flex min-h-[22px] flex-wrap gap-1.5">
        {product.isNew ? <Badge variant="success">{t('new')}</Badge> : null}
        {product.isSpicy ? <Badge variant="outline">{t('spicy')}</Badge> : null}
        {product.isVegetarian ? <Badge variant="secondary">{t('vegetarian')}</Badge> : null}
      </div>

      <h3 className="font-heading text-lg font-black leading-tight">{product.name}</h3>

      {product.description ? (
        <p className="line-clamp-2 flex-1 text-sm leading-relaxed text-foreground/75">{product.description}</p>
      ) : (
        <div className="flex-1" />
      )}

      <div className="mt-1 flex items-center justify-between gap-2.5">
        <span className="font-heading text-[19px] font-black">
          {isPizza ? <span className="text-xs font-normal text-muted-foreground">{tc('from')} </span> : null}
          {formatPrice(product.priceFrom)}
        </span>
        <Button size="sm" className="h-11 px-4" onClick={() => onSelect(product)}>
          {isPizza ? t('customize') : t('addToCart')}
        </Button>
      </div>
    </article>
  );
}
