'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { AdminProduct } from '@/shared/api/types';
import { ApiError } from '@/shared/api/api-client';
import { kopecksToRubles, rublesToKopecks } from '@/shared/lib/format';
import { useFormatters } from '@/shared/lib/use-formatters';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { Checkbox } from '@/shared/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { FormField } from '@/shared/ui/form-field';
import { Input } from '@/shared/ui/input';
import { Pagination } from '@/shared/ui/pagination';
import { Skeleton } from '@/shared/ui/skeleton';
import { Textarea } from '@/shared/ui/textarea';
import { useCategories } from '@/entities/product/queries';
import { adminApi } from '@/features/admin/api';
import { slugify } from '@/features/admin/slugify';

/**
 * The menu editor.
 *
 * The panel had no way to touch a product at all: the menu was whatever the
 * seed script had written, and the one thing staff could change was the stop
 * list. So a new drink meant a developer and a deploy — and the flavours a
 * product is sold in, which the constructor asks about and the kitchen ticket
 * prints, were settable only by re-running the seed.
 *
 * Deliberately not a general-purpose CMS. Sizes and the recipe stay out: a
 * pizza's sizes are priced per product and its ingredients drive the
 * constructor's "remove" list, so both deserve their own screen rather than a
 * corner of this one. What is here is what a shop changes week to week — the
 * name, the description, the price, the flavours, and whether it is on sale.
 */

/** Enough of the menu to find anything by eye; the search narrows the rest. */
const PAGE_SIZE = 50;

/** A flavour being edited. `slug` is derived but editable — see `slugify`. */
interface VariantDraft {
  name: string;
  slug: string;
}

interface Draft {
  name: string;
  description: string;
  /** Roubles in the form, kopecks over the wire. */
  priceRub: string;
  isActive: boolean;
  isVegetarian: boolean;
  isSpicy: boolean;
  isHalal: boolean;
  isNew: boolean;
  isPopular: boolean;
  variants: VariantDraft[];
}

function draftFrom(product: AdminProduct): Draft {
  return {
    name: product.name,
    description: product.description ?? '',
    priceRub: String(kopecksToRubles(product.basePrice)),
    isActive: product.isActive,
    isVegetarian: product.isVegetarian,
    isSpicy: product.isSpicy,
    isHalal: product.isHalal,
    isNew: product.isNew,
    isPopular: product.isPopular,
    variants: product.variants.map((variant) => ({ name: variant.name, slug: variant.slug })),
  };
}

export default function AdminProductsPage() {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const tcat = useTranslations('catalog');
  const { formatPrice } = useFormatters();
  const qc = useQueryClient();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<AdminProduct | null>(null);

  const { data: categories = [] } = useCategories();
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'products', page, search],
    queryFn: () => adminApi.listProducts(page, search || undefined, PAGE_SIZE),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'products'] });
    // The customer-facing list is a different query with its own cache, and it
    // is the one the shop will look at to check the change landed.
    qc.invalidateQueries({ queryKey: ['products'] });
  };

  const save = useMutation({
    mutationFn: ({ productId, draft }: { productId: string; draft: Draft }) =>
      adminApi.updateProduct(productId, {
        name: draft.name.trim(),
        description: draft.description.trim() || undefined,
        basePrice: rublesToKopecks(Number(draft.priceRub) || 0),
        isActive: draft.isActive,
        isVegetarian: draft.isVegetarian,
        isSpicy: draft.isSpicy,
        isHalal: draft.isHalal,
        isNew: draft.isNew,
        isPopular: draft.isPopular,
        // Always sent, including empty: the server reads an omitted field as
        // "leave the flavours alone" and `[]` as "this has none", and clearing
        // the last flavour has to be sayable.
        variants: draft.variants
          .filter((variant) => variant.name.trim() && variant.slug.trim())
          .map((variant, index) => ({
            name: variant.name.trim(),
            slug: variant.slug.trim(),
            sortOrder: index,
          })),
      }),
    onSuccess: () => {
      refresh();
      setEditing(null);
      toast.success(t('productSaved'));
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : t('productSaveFailed')),
  });

  const delist = useMutation({
    mutationFn: (productId: string) => adminApi.deleteProduct(productId),
    onSuccess: () => {
      refresh();
      toast.success(t('productDelisted'));
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : t('productSaveFailed')),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            // A narrower list would otherwise leave the admin on an empty page 3.
            setPage(1);
          }}
          placeholder={tcat('searchPlaceholder')}
          aria-label={tc('search')}
          className="w-full sm:w-72"
        />
        <p className="text-sm text-muted-foreground">{t('productsHint')}</p>
      </div>

      {isLoading ? (
        <Skeleton className="h-64" />
      ) : data?.items.length ? (
        <div className="space-y-2">
          {data.items.map((product) => (
            <Card key={product.id}>
              <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {product.name}
                    {product.isActive ? null : <Badge variant="secondary">{t('delisted')}</Badge>}
                    {product.isNew ? <Badge variant="new">{tcat('new')}</Badge> : null}
                    {product.isPopular ? <Badge variant="secondary">{tcat('popular')}</Badge> : null}
                  </p>
                  <p className="truncate text-muted-foreground">
                    {product.category?.name ?? '—'} ·{' '}
                    {/* A pizza is priced per size, so the stored `basePrice` is
                        not what anybody pays — show the cheapest instead. */}
                    {product.sizes.length
                      ? `${tc('from')} ${formatPrice(product.priceFrom)}`
                      : formatPrice(product.basePrice)}
                    {product.variants.length
                      ? ` · ${t('flavourCount', { count: product.variants.length })}`
                      : ''}
                  </p>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  // Named after the product: a list of fifty identical
                  // "Изменить" buttons tells a screen reader nothing.
                  aria-label={t('editProduct', { name: product.name })}
                  onClick={() => setEditing(product)}
                >
                  <Pencil className="h-4 w-4" aria-hidden />
                  {tc('edit')}
                </Button>

                {product.isActive ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    aria-label={t('delistProduct', { name: product.name })}
                    // Soft delete: order history points at the product, so it is
                    // taken off the menu rather than removed.
                    onClick={() => {
                      if (window.confirm(t('delistConfirm', { name: product.name }))) {
                        delist.mutate(product.id);
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                    {t('delist')}
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <p className="py-16 text-center text-muted-foreground">{tc('nothingFound')}</p>
      )}

      <Pagination page={page} totalPages={data?.totalPages ?? 1} onChange={setPage} />

      <ProductDialog
        product={editing}
        categories={categories}
        saving={save.isPending}
        onClose={() => setEditing(null)}
        onSave={(draft) => editing && save.mutate({ productId: editing.id, draft })}
      />
    </div>
  );
}

function ProductDialog({
  product,
  categories,
  saving,
  onClose,
  onSave,
}: {
  product: AdminProduct | null;
  categories: { id: string; name: string }[];
  saving: boolean;
  onClose: () => void;
  onSave: (draft: Draft) => void;
}) {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const tcat = useTranslations('catalog');
  const tconstructor = useTranslations('constructor');

  const [draft, setDraft] = useState<Draft | null>(null);

  // Re-seeded whenever the dialog is opened on a different product: the form is
  // local state, so without this it would keep the previous item's values.
  useEffect(() => {
    setDraft(product ? draftFrom(product) : null);
  }, [product]);

  if (!product || !draft) return null;

  const patch = (change: Partial<Draft>) => setDraft({ ...draft, ...change });

  const setVariant = (index: number, change: Partial<VariantDraft>) =>
    patch({
      variants: draft.variants.map((variant, i) => (i === index ? { ...variant, ...change } : variant)),
    });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{product.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <FormField label={t('productName')} htmlFor="product-name">
            <Input
              id="product-name"
              value={draft.name}
              onChange={(event) => patch({ name: event.target.value })}
            />
          </FormField>

          <FormField label={tcat('composition')} htmlFor="product-description">
            <Textarea
              id="product-description"
              rows={2}
              value={draft.description}
              onChange={(event) => patch({ description: event.target.value })}
            />
          </FormField>

          <FormField
            label={t('productPrice')}
            htmlFor="product-price"
            // A pizza is priced per size, and sizes are not edited here.
            hint={product.sizes.length ? t('pizzaPricedBySize') : undefined}
          >
            <Input
              id="product-price"
              type="number"
              min={0}
              step={1}
              disabled={product.sizes.length > 0}
              value={draft.priceRub}
              onChange={(event) => patch({ priceRub: event.target.value })}
            />
          </FormField>

          {/* ── Flavours ─────────────────────────────────────────── */}
          <section className="space-y-2">
            <h3 className="text-sm font-medium">{tconstructor('flavour')}</h3>
            <p className="text-xs text-muted-foreground">{t('flavoursHint')}</p>

            {draft.variants.map((variant, index) => (
              <div key={index} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:flex sm:items-start">
                <Input
                  aria-label={t('flavourName', { position: index + 1 })}
                  value={variant.name}
                  onChange={(event) => {
                    const name = event.target.value;
                    // The slug follows the name until someone edits it by hand:
                    // after that it is left alone, because it is half of the
                    // key the flavour is stored under.
                    const untouched = variant.slug === slugify(variant.name);
                    setVariant(index, { name, ...(untouched ? { slug: slugify(name) } : {}) });
                  }}
                />
                <Input
                  aria-label={t('flavourSlug', { position: index + 1 })}
                  className="row-start-2 font-mono text-xs sm:w-40"
                  value={variant.slug}
                  onChange={(event) => setVariant(index, { slug: event.target.value })}
                />
                <Button
                  variant="outline"
                  size="icon"
                  className="col-start-2 row-span-2 row-start-1 shrink-0 self-center"
                  aria-label={t('removeFlavour', { name: variant.name || String(index + 1) })}
                  onClick={() => patch({ variants: draft.variants.filter((_, i) => i !== index) })}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            ))}

            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => patch({ variants: [...draft.variants, { name: '', slug: '' }] })}
            >
              <Plus className="h-4 w-4" aria-hidden />
              {t('addFlavour')}
            </Button>
          </section>

          {/* ── Flags ────────────────────────────────────────────── */}
          <section className="flex flex-wrap gap-4 border-t pt-4">
            <Checkbox
              checked={draft.isActive}
              onChange={(event) => patch({ isActive: event.target.checked })}
              label={t('onSale')}
            />
            <Checkbox
              checked={draft.isHalal}
              onChange={(event) => patch({ isHalal: event.target.checked })}
              label={tcat('halal')}
            />
            <Checkbox
              checked={draft.isVegetarian}
              onChange={(event) => patch({ isVegetarian: event.target.checked })}
              label={tcat('vegetarian')}
            />
            <Checkbox
              checked={draft.isSpicy}
              onChange={(event) => patch({ isSpicy: event.target.checked })}
              label={tcat('spicy')}
            />
            <Checkbox
              checked={draft.isNew}
              onChange={(event) => patch({ isNew: event.target.checked })}
              label={tcat('new')}
            />
            <Checkbox
              checked={draft.isPopular}
              onChange={(event) => patch({ isPopular: event.target.checked })}
              label={tcat('popular')}
            />
          </section>

          {/* The category is shown, not edited: moving a product between
              categories reshuffles the menu, and the API has no patch for it. */}
          <p className="text-xs text-muted-foreground">
            {t('productCategory')}:{' '}
            {categories.find((category) => category.id === product.categoryId)?.name ??
              product.category?.name ??
              '—'}
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button
            // A name is the one field nothing else can stand in for.
            disabled={!draft.name.trim()}
            loading={saving}
            onClick={() => onSave(draft)}
          >
            {tc('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
