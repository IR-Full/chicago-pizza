'use client';

import { useTranslations } from 'next-intl';
import { Minus, Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { Product } from '@/shared/api/types';
import { ApiError } from '@/shared/api/api-client';
import { useFormatters } from '@/shared/lib/use-formatters';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { useDoughTypes, useProducts } from '@/entities/product/queries';
import { useAddToCart } from '@/entities/cart/queries';
import { usePizzaConfig } from '../model/use-pizza-config';

interface PizzaConstructorDialogProps {
  product: Product | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PizzaConstructorDialog({ product, open, onOpenChange }: PizzaConstructorDialogProps) {
  if (!product) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <ConstructorBody product={product} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function ConstructorBody({ product, onDone }: { product: Product; onDone: () => void }) {
  const t = useTranslations('constructor');
  const tc = useTranslations('cart');
  const { formatPrice } = useFormatters();

  const { data: doughTypes = [] } = useDoughTypes();
  const { data: pizzaList } = useProducts({ categorySlug: 'pizza', limit: 100 });
  const addToCart = useAddToCart();

  const state = usePizzaConfig({ product, doughTypes });

  const otherPizzas = (pizzaList?.items ?? []).filter((p) => p.id !== product.id);

  async function handleAdd() {
    // No account needed to fill a basket. `useAddToCart` puts a guest's line
    // in this browser and has the server price it; signing in merges it into
    // the account. This used to refuse and redirect to /login, which was
    // written before the guest cart existed and never revisited when it
    // landed — so every other piece of that feature (the local store, the
    // preview pricing, the merge on sign-in, the cart page's own promise that
    // "корзина сохранится") sat unreachable behind this one check, and an
    // account was demanded before the first pizza after all.
    try {
      await addToCart.mutateAsync({ config: state.config, quantity: state.quantity });
      toast.success(`${product.name} — ${tc('title').toLowerCase()}`);
      onDone();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Не удалось добавить в корзину');
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{state.isPizza ? t('title') : product.name}</DialogTitle>
      </DialogHeader>

      <div className="space-y-5">
        {product.description ? <p className="text-sm text-muted-foreground">{product.description}</p> : null}

        {/*
          Flavour. Outside the pizza block on purpose: this is what a drink
          sold in six flavours needs, and the only picker it gets.
        */}
        {(product.variants ?? []).length ? (
          <section className="space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-[0.08em] text-brand-700">{t('flavour')}</h4>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {(product.variants ?? []).map((variant) => (
                <button
                  key={variant.id}
                  type="button"
                  aria-pressed={state.variantId === variant.id}
                  onClick={() => state.setVariantId(variant.id)}
                  className={cn(
                    'min-h-11 rounded-full border px-3 py-2 text-sm transition-colors',
                    state.variantId === variant.id
                      ? 'border-primary bg-primary font-heading font-black text-primary-foreground'
                      : 'hover:bg-foreground/[0.07]',
                  )}
                >
                  {variant.name}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {state.isPizza ? (
          <>
            {/* Size */}
            <section className="space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-[0.08em] text-brand-700">{t('size')}</h4>
              <div className="grid grid-cols-3 gap-2">
                {product.sizes.map((size) => (
                  <button
                    key={size.id}
                    type="button"
                    onClick={() => state.setSizeCm(size.sizeCm)}
                    className={cn(
                      'min-h-11 rounded-full border px-3 py-2 text-sm transition-colors',
                      state.sizeCm === size.sizeCm
                        ? 'border-primary bg-primary font-heading font-black text-primary-foreground'
                        : 'hover:bg-foreground/[0.07]',
                    )}
                  >
                    {size.label}
                  </button>
                ))}
              </div>
            </section>

            {/* Dough */}
            <section className="space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-[0.08em] text-brand-700">{t('dough')}</h4>
              <div className="grid grid-cols-3 gap-2">
                {doughTypes.map((dough) => (
                  <button
                    key={dough.id}
                    type="button"
                    onClick={() => state.setDoughTypeId(dough.id)}
                    className={cn(
                      'min-h-11 rounded-2xl border px-3 py-2 text-sm transition-colors',
                      state.doughTypeId === dough.id
                        ? 'border-primary bg-primary font-heading font-black text-primary-foreground'
                        : 'hover:bg-foreground/[0.07]',
                    )}
                  >
                    <span className="block">{dough.name}</span>
                    {dough.priceModifier > 0 ? (
                      <span className="text-xs opacity-80">+{formatPrice(dough.priceModifier)}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            </section>

            {/* Halves */}
            <section className="space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-[0.08em] text-brand-700">{t('halves')}</h4>
              <p className="text-xs text-muted-foreground">{t('priceNote')}</p>
              <select
                value={state.secondHalfProductId ?? ''}
                onChange={(e) => state.setSecondHalfProductId(e.target.value || undefined)}
                className="h-11 w-full rounded-full border border-input bg-card px-4 text-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <option value="">{t('singleFlavour')}</option>
                {otherPizzas.map((pizza) => (
                  <option key={pizza.id} value={pizza.id}>
                    {t('secondHalf')}: {pizza.name}
                  </option>
                ))}
              </select>
            </section>

            {/* Recipe ingredients (removable) */}
            {product.ingredients.length ? (
              <section className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-[0.08em] text-brand-700">
                  {t('inRecipe')}
                </h4>
                <div className="flex flex-wrap gap-3">
                  {product.ingredients
                    .filter((i) => i.isDefault)
                    .map((ingredient) => {
                      const isRemoved = state.removedIngredientIds.includes(ingredient.id);
                      return (
                        <Checkbox
                          key={ingredient.id}
                          checked={!isRemoved}
                          onChange={() => state.toggleRemovedIngredient(ingredient.id)}
                          label={
                            <span className={cn(isRemoved && 'text-muted-foreground line-through')}>
                              {ingredient.name}
                            </span>
                          }
                        />
                      );
                    })}
                </div>
              </section>
            ) : null}
          </>
        ) : null}

        {/*
          A price that failed to compute leaves the button disabled, so the
          reason has to be on screen — otherwise the customer is looking at a
          dead control with no idea why.
        */}
        {state.priceError && !state.isPricing ? (
          <p role="alert" className="text-sm text-destructive">
            {state.priceError instanceof ApiError ? state.priceError.message : t('priceFailed')}
          </p>
        ) : null}

        {/* Quantity + total */}
        <div className="flex items-center justify-between gap-4 border-t pt-4">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="-"
              onClick={() => state.setQuantity(Math.max(1, state.quantity - 1))}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <span className="w-8 text-center font-heading font-black">{state.quantity}</span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="+"
              onClick={() => state.setQuantity(Math.min(50, state.quantity + 1))}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          <Button
            className="flex-1 sm:flex-none sm:min-w-56"
            size="lg"
            onClick={handleAdd}
            loading={addToCart.isPending}
            disabled={state.isPricing || !state.price}
          >
            {t('addToCart')}
            {state.price ? ` · ${formatPrice(state.price.totalPrice)}` : ''}
          </Button>
        </div>
      </div>
    </>
  );
}
