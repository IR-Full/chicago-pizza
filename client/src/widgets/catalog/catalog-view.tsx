'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Search, SlidersHorizontal } from 'lucide-react';
import type { Product } from '@/shared/api/types';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import { Input } from '@/shared/ui/input';
import { Pagination } from '@/shared/ui/pagination';
import { Skeleton } from '@/shared/ui/skeleton';
import { ProductCard } from '@/entities/product/ui/product-card';
import {
  CATALOG_FLAGS,
  hasActiveCatalogFilters,
  parseCatalogParams,
  readerFromSearchParams,
  type CatalogFlagParam,
} from '@/entities/product/catalog-params';
import { useCategories, useFavorites, useProducts, useToggleFavorite } from '@/entities/product/queries';
import { useCurrentUser } from '@/entities/user/queries';
import { PizzaConstructorDialog } from '@/features/pizza-constructor/ui/pizza-constructor-dialog';
import styles from './catalog-view.module.css';

/** Debounces the search box so typing does not fire a request per keystroke. */
function useDebounced<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function CatalogView() {
  const t = useTranslations('catalog');
  const tc = useTranslations('common');

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // The URL is the only source of truth for what is being shown. Everything
  // below reads from it, which is what makes a filtered menu a real address.
  const filters = parseCatalogParams(readerFromSearchParams(searchParams));

  // Depended on as a string, not as the `searchParams` object: the callbacks
  // below would otherwise be rebuilt whenever that object's identity changed,
  // and every effect keyed on them would re-run for no reason.
  const paramsString = searchParams.toString();

  /**
   * Writes a patch back into the URL.
   *
   * `history: 'replace'` is for the search box, which would otherwise push a
   * history entry per debounced keystroke and bury the previous page under
   * twenty of them. Discrete choices — a category, a facet, a page — push, so
   * the back button undoes them one at a time, which is what a visitor expects
   * from something that changed the address bar.
   */
  const setParams = useCallback(
    (patch: Record<string, string | undefined>, history: 'push' | 'replace' = 'push') => {
      const next = new URLSearchParams(paramsString);

      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined || value === '') next.delete(key);
        else next.set(key, value);
      }

      const query = next.toString();
      const url = query ? `${pathname}?${query}` : pathname;
      // Never scroll: a filter change happens under the visitor's cursor, and
      // jumping to the top of the page loses their place in the grid.
      router[history](url, { scroll: false });
    },
    [pathname, router, paramsString],
  );

  /**
   * Narrowing the list always returns to the first page. Without it a narrower
   * filter lands the visitor on an empty page 3.
   *
   * This used to be an effect (`useEffect(() => setPage(1), [filters])`), which
   * fired *after* the query had already gone out with the old page number — so
   * every filter change cost two requests, one of them for a page nobody was
   * going to see. Clearing `page` in the same URL write that changes the filter
   * makes it one.
   */
  const narrow = useCallback(
    (patch: Record<string, string | undefined>, history: 'push' | 'replace' = 'push') =>
      setParams({ ...patch, page: undefined }, history),
    [setParams],
  );

  // The text box has to feel instant, so typing is local; the URL catches up
  // once the typing stops.
  const [typed, setTyped] = useState(filters.search ?? '');
  const debouncedSearch = useDebounced(typed);

  useEffect(() => {
    if (debouncedSearch === (filters.search ?? '')) return;
    narrow({ q: debouncedSearch || undefined }, 'replace');
  }, [debouncedSearch, filters.search, narrow]);

  // Keeps the box in step when the URL moves on its own — a back button, or a
  // link someone opened with a search already in it.
  useEffect(() => {
    setTyped(filters.search ?? '');
  }, [filters.search]);

  const [showFilters, setShowFilters] = useState(() => hasActiveCatalogFilters(filters));
  const [selected, setSelected] = useState<Product | null>(null);

  const { data: user } = useCurrentUser();
  const { data: categories = [] } = useCategories();
  const { data: favorites = [] } = useFavorites();
  const toggleFavorite = useToggleFavorite();

  // Same key the server prefetched under, so the first paint uses that data
  // instead of fetching it again.
  const { data, isPending } = useProducts(filters);

  const favoriteIds = new Set(favorites.map((f) => f.id));
  const activeFilters = hasActiveCatalogFilters(filters);

  return (
    <div className="container py-[clamp(1.75rem,5vw,4rem)]">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3 border-b border-border">
        <h1 className="font-heading text-[clamp(2.75rem,7vw,5.5rem)] font-black uppercase leading-none tracking-tight sm:pb-3">
          {t('title')}
        </h1>

        <nav className="flex max-w-full flex-wrap gap-x-5 sm:gap-x-7" aria-label={t('title')}>
          <CategoryButton active={!filters.categorySlug} onClick={() => narrow({ category: undefined })}>
            {t('allCategories')}
          </CategoryButton>
          {categories.map((category) => (
            <CategoryButton
              key={category.id}
              active={filters.categorySlug === category.slug}
              onClick={() => narrow({ category: category.slug })}
            >
              {category.name}
            </CategoryButton>
          ))}
        </nav>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 sm:mt-5 sm:gap-3">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="pl-9"
            aria-label={tc('search')}
          />
        </div>

        <Button
          type="button"
          variant="outline"
          aria-expanded={showFilters}
          aria-controls="catalog-filter-options"
          onClick={() => setShowFilters((v) => !v)}
          className="shrink-0 gap-1.5 px-3.5"
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden />
          {t('filters')}
        </Button>
      </div>

      <div id="catalog-filter-options">
        {showFilters ? (
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-border pb-4">
            {/* First in the row on purpose: in Makhachkala this is the filter
                most customers are actually looking for. */}
            <FlagCheckbox param="halal" label={t('halal')} filters={filters} onToggle={narrow} />
            <FlagCheckbox param="veg" label={t('vegetarian')} filters={filters} onToggle={narrow} />
            <FlagCheckbox param="spicy" label={t('spicy')} filters={filters} onToggle={narrow} />
            <FlagCheckbox param="new" label={t('new')} filters={filters} onToggle={narrow} />
            <FlagCheckbox param="popular" label={t('popular')} filters={filters} onToggle={narrow} />
            {activeFilters ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  // The box is local state, so clearing the URL is not enough:
                  // a debounced write already in flight would put the search
                  // back a third of a second after the visitor cleared it.
                  setTyped('');
                  narrow({
                    q: undefined,
                    halal: undefined,
                    veg: undefined,
                    spicy: undefined,
                    new: undefined,
                    popular: undefined,
                  });
                }}
              >
                {t('resetFilters')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {isPending ? (
        <div className={styles.products} aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={styles.tile}>
              <Skeleton className="h-36 rounded-sm sm:h-80" />
            </div>
          ))}
        </div>
      ) : data?.items.length ? (
        <div className={styles.products}>
          {data.items.map((product) => (
            <div key={product.id} className={styles.tile}>
              <ProductCard
                product={product}
                mobileRow
                showFavorite={!!user}
                isFavorite={favoriteIds.has(product.id)}
                onSelect={setSelected}
                onToggleFavorite={(p) =>
                  toggleFavorite.mutate({ productId: p.id, isFavorite: favoriteIds.has(p.id) })
                }
              />
            </div>
          ))}
        </div>
      ) : (
        <p className="py-16 text-center text-muted-foreground">{tc('nothingFound')}</p>
      )}

      <Pagination
        page={filters.page ?? 1}
        totalPages={data?.totalPages ?? 1}
        getHref={(page) => {
          const next = new URLSearchParams(paramsString);
          if (page > 1) next.set('page', String(page));
          else next.delete('page');
          return next.size ? `${pathname}?${next}` : pathname;
        }}
        onChange={(page) => setParams({ page: page > 1 ? String(page) : undefined })}
        className="pt-5"
      />

      <PizzaConstructorDialog
        product={selected}
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </div>
  );
}

function FlagCheckbox({
  param,
  label,
  filters,
  onToggle,
}: {
  param: CatalogFlagParam;
  label: string;
  filters: ReturnType<typeof parseCatalogParams>;
  onToggle: (patch: Record<string, string | undefined>) => void;
}) {
  const checked = filters[CATALOG_FLAGS[param]] === true;
  return (
    <Checkbox
      checked={checked}
      onChange={(e) => onToggle({ [param]: e.target.checked ? '1' : undefined })}
      label={label}
    />
  );
}

function CategoryButton({
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
        'inline-flex min-h-11 items-center border-b-2 px-0.5 py-2 text-sm font-semibold transition-colors',
        active
          ? 'border-primary text-brand-700'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
