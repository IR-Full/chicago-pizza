'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Search, SlidersHorizontal } from 'lucide-react';
import type { Product } from '@/shared/api/types';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import { Input } from '@/shared/ui/input';
import { Skeleton } from '@/shared/ui/skeleton';
import { ProductCard } from '@/entities/product/ui/product-card';
import { useCategories, useFavorites, useProducts, useToggleFavorite } from '@/entities/product/queries';
import { useCurrentUser } from '@/entities/user/queries';
import { PizzaConstructorDialog } from '@/features/pizza-constructor/ui/pizza-constructor-dialog';

/** Debounces the search box so typing does not fire a request per keystroke. */
function useDebounced<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function CatalogView({ initialCategory }: { initialCategory?: string }) {
  const t = useTranslations('catalog');
  const tc = useTranslations('common');

  const [categorySlug, setCategorySlug] = useState<string | undefined>(initialCategory);
  const [searchInput, setSearchInput] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    isVegetarian: false,
    isSpicy: false,
    isNew: false,
    isPopular: false,
  });
  const [selected, setSelected] = useState<Product | null>(null);

  const search = useDebounced(searchInput);

  const { data: user } = useCurrentUser();
  const { data: categories = [] } = useCategories();
  const { data: favorites = [] } = useFavorites();
  const toggleFavorite = useToggleFavorite();

  const query = useMemo(
    () => ({
      categorySlug,
      search: search || undefined,
      // Only send a flag when it is actually on — `false` would filter out
      // everything that is merely not spicy/vegetarian.
      isVegetarian: filters.isVegetarian || undefined,
      isSpicy: filters.isSpicy || undefined,
      isNew: filters.isNew || undefined,
      isPopular: filters.isPopular || undefined,
      limit: 60,
    }),
    [categorySlug, search, filters],
  );

  const { data, isLoading } = useProducts(query);
  const favoriteIds = new Set(favorites.map((f) => f.id));
  const hasActiveFilters = Object.values(filters).some(Boolean) || !!search;

  return (
    <div className="container space-y-6 py-[clamp(1.5rem,4vw,3.5rem)]">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto font-heading text-[clamp(2.125rem,4.4vw,3.5rem)] font-black leading-[1.08] tracking-[-0.02em]">
          {t('title')}
        </h1>

        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="pl-9"
            aria-label={tc('search')}
          />
        </div>

        <Button variant="outline" onClick={() => setShowFilters((v) => !v)} className="gap-2">
          <SlidersHorizontal className="h-4 w-4" />
          {t('filters')}
        </Button>
      </div>

      {showFilters ? (
        <div className="flex flex-wrap items-center gap-4 rounded-card bg-card p-5">
          <Checkbox
            checked={filters.isVegetarian}
            onChange={(e) => setFilters((f) => ({ ...f, isVegetarian: e.target.checked }))}
            label={t('vegetarian')}
          />
          <Checkbox
            checked={filters.isSpicy}
            onChange={(e) => setFilters((f) => ({ ...f, isSpicy: e.target.checked }))}
            label={t('spicy')}
          />
          <Checkbox
            checked={filters.isNew}
            onChange={(e) => setFilters((f) => ({ ...f, isNew: e.target.checked }))}
            label={t('new')}
          />
          <Checkbox
            checked={filters.isPopular}
            onChange={(e) => setFilters((f) => ({ ...f, isPopular: e.target.checked }))}
            label={t('popular')}
          />
          {hasActiveFilters ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFilters({ isVegetarian: false, isSpicy: false, isNew: false, isPopular: false });
                setSearchInput('');
              }}
            >
              {t('resetFilters')}
            </Button>
          ) : null}
        </div>
      ) : null}

      <nav className="flex flex-wrap gap-2" aria-label={t('title')}>
        <CategoryChip active={!categorySlug} onClick={() => setCategorySlug(undefined)}>
          {t('allCategories')}
        </CategoryChip>
        {categories.map((category) => (
          <CategoryChip
            key={category.id}
            active={categorySlug === category.slug}
            onClick={() => setCategorySlug(category.slug)}
          >
            {category.name}
          </CategoryChip>
        ))}
      </nav>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-[clamp(1rem,2vw,1.625rem)] lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-[22rem]" />
          ))}
        </div>
      ) : data?.items.length ? (
        <div className="grid grid-cols-2 gap-[clamp(1rem,2vw,1.625rem)] lg:grid-cols-4">
          {data.items.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              showFavorite={!!user}
              isFavorite={favoriteIds.has(product.id)}
              onSelect={setSelected}
              onToggleFavorite={(p) =>
                toggleFavorite.mutate({ productId: p.id, isFavorite: favoriteIds.has(p.id) })
              }
            />
          ))}
        </div>
      ) : (
        <p className="py-16 text-center text-muted-foreground">{tc('nothingFound')}</p>
      )}

      <PizzaConstructorDialog
        product={selected}
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </div>
  );
}

function CategoryChip({
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
      aria-current={active ? 'true' : undefined}
      className={cn(
        'inline-flex h-11 items-center rounded-full px-4 font-heading text-sm font-black transition-colors',
        active
          ? 'bg-primary text-primary-foreground hover:bg-brand-600'
          : 'border border-border hover:bg-foreground/[0.07]',
      )}
    >
      {children}
    </button>
  );
}
