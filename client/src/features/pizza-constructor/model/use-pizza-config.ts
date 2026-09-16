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

  const [sizeCm, setSizeCm] = useState<number | undefined>(() => product.sizes[0]?.sizeCm);
  const [doughTypeId, setDoughTypeId] = useState<string | undefined>(() => doughTypes[0]?.id);
  const [secondHalfProductId, setSecondHalfProductId] = useState<string | undefined>();
  const [addedIngredientIds, setAddedIngredientIds] = useState<string[]>([]);
  const [removedIngredientIds, setRemovedIngredientIds] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);

  // Reset when the dialog is reused for a different product.
  useEffect(() => {
    setSizeCm(product.sizes[0]?.sizeCm);
    setSecondHalfProductId(undefined);
    setAddedIngredientIds([]);
    setRemovedIngredientIds([]);
    setQuantity(1);
  }, [product.id, product.sizes]);

  useEffect(() => {
    if (!doughTypeId && doughTypes.length) setDoughTypeId(doughTypes[0].id);
  }, [doughTypes, doughTypeId]);

  const config: PizzaConfig = useMemo(
    () => ({
      productId: product.id,
      ...(isPizza
        ? {
            sizeCm,
            doughTypeId,
            secondHalfProductId,
            addedIngredientIds: addedIngredientIds.length ? addedIngredientIds : undefined,
            removedIngredientIds: removedIngredientIds.length ? removedIngredientIds : undefined,
          }
        : {}),
    }),
    [product.id, isPizza, sizeCm, doughTypeId, secondHalfProductId, addedIngredientIds, removedIngredientIds],
  );

  const priceQuery = useQuery({
    queryKey: ['pizza-price', config, quantity],
    queryFn: () => productApi.price(config, quantity),
    // A pizza needs a size before it can be priced at all.
    enabled: !isPizza || !!sizeCm,
    staleTime: 60_000,
  });

  function toggleAddedIngredient(id: string) {
    setAddedIngredientIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

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
    addedIngredientIds,
    toggleAddedIngredient,
    removedIngredientIds,
    toggleRemovedIngredient,
    price: priceQuery.data,
    isPricing: priceQuery.isFetching,
    priceError: priceQuery.error,
  };
}
