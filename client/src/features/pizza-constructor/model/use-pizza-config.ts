'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { productApi } from '@/entities/product/api';
import type { DoughType, PizzaConfig, Product } from '@/shared/api/types';

interface UsePizzaConfigOptions {
  product: Product;
  doughTypes: DoughType[];
}

/**
 * Owns the constructor's local state and asks the server for the price on
 * every change. The server is the only authority on price — the UI never
 * computes it, so what the customer sees always matches what checkout charges.
 */
export function usePizzaConfig({ product, doughTypes }: UsePizzaConfigOptions) {
  const isPizza = product.type === 'PIZZA';
  // `?? []` because a client can outlive the server it was built against: a
  // payload from before variants existed has no such field, and crashing the
  // constructor is a worse answer than offering no flavours.
  const variants = product.variants ?? [];

  const [sizeCm, setSizeCm] = useState<number | undefined>(() => product.sizes[0]?.sizeCm);
  const [doughTypeId, setDoughTypeId] = useState<string | undefined>(() => doughTypes[0]?.id);
  const [secondHalfProductId, setSecondHalfProductId] = useState<string | undefined>();
  // Preselected, so a drink sold in six flavours still costs one tap. The
  // server refuses a variant product with no variant chosen, and a dialog
  // that opened in a refused state would just show an error nobody caused.
  const [variantId, setVariantId] = useState<string | undefined>(() => variants[0]?.id);
  const [removedIngredientIds, setRemovedIngredientIds] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);

  // Reset when the dialog is reused for a different product.
  useEffect(() => {
    setSizeCm(product.sizes[0]?.sizeCm);
    setVariantId((product.variants ?? [])[0]?.id);
    setSecondHalfProductId(undefined);
    setRemovedIngredientIds([]);
    setQuantity(1);
  }, [product.id, product.sizes, product.variants]);

  useEffect(() => {
    if (!doughTypeId && doughTypes.length) setDoughTypeId(doughTypes[0].id);
  }, [doughTypes, doughTypeId]);

  const config: PizzaConfig = useMemo(
    () => ({
      productId: product.id,
      // Not inside the pizza-only block below: a flavour belongs to drinks.
      ...(variantId ? { variantId } : {}),
      ...(isPizza
        ? {
            sizeCm,
            doughTypeId,
            secondHalfProductId,
            removedIngredientIds: removedIngredientIds.length ? removedIngredientIds : undefined,
          }
        : {}),
    }),
    [product.id, isPizza, sizeCm, doughTypeId, variantId, secondHalfProductId, removedIngredientIds],
  );

  const priceQuery = useQuery({
    queryKey: ['pizza-price', config, quantity],
    queryFn: () => productApi.price(config, quantity),
    // A pizza needs a size before it can be priced at all, and a product sold
    // in flavours needs one of those — the server refuses either way, and a
    // request made only to be refused leaves the add button dead with an
    // error the customer did not cause.
    enabled: (!isPizza || !!sizeCm) && (!variants.length || !!variantId),
    staleTime: 60_000,
  });

  function toggleRemovedIngredient(id: string) {
    setRemovedIngredientIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return {
    isPizza,
    config,
    quantity,
    setQuantity,
    sizeCm,
    setSizeCm,
    doughTypeId,
    setDoughTypeId,
    secondHalfProductId,
    setSecondHalfProductId,
    variantId,
    setVariantId,
    removedIngredientIds,
    toggleRemovedIngredient,
    price: priceQuery.data,
    isPricing: priceQuery.isFetching,
    priceError: priceQuery.error,
  };
}
