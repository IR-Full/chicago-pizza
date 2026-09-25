'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from '@/entities/user/queries';
import { productApi, type ProductFilters } from './api';

export const productKeys = {
  branches: ['products', 'branches'] as const,
  deliveryQuote: (lat: number, lng: number) => ['products', 'delivery-quote', lat, lng] as const,
  categories: ['products', 'categories'] as const,
  doughTypes: ['products', 'dough-types'] as const,
  ingredients: ['products', 'ingredients'] as const,
  list: (filters: ProductFilters) => ['products', 'list', filters] as const,
  detail: (slug: string) => ['products', 'detail', slug] as const,
  recommendations: ['products', 'recommendations'] as const,
  favorites: ['products', 'favorites'] as const,
};

// Catalog reference data barely changes; cache it for the session.
const REFERENCE_STALE_TIME = 5 * 60 * 1000;

export function useBranches() {
  return useQuery({
    queryKey: productKeys.branches,
    queryFn: productApi.branches,
    staleTime: REFERENCE_STALE_TIME,
  });
}

/**
 * What delivery to this address costs.
 *
 * Only asked once an address with a map pin is selected: a street and a house
 * number cannot be tested against a polygon, so those keep the flat tariff.
 */
export function useDeliveryQuote(coordinates: { lat: number | null; lng: number | null } | null) {
  const lat = coordinates?.lat ?? null;
  const lng = coordinates?.lng ?? null;

  return useQuery({
    queryKey: productKeys.deliveryQuote(lat ?? 0, lng ?? 0),
    queryFn: () => productApi.deliveryQuote(lat!, lng!),
    enabled: lat !== null && lng !== null,
  });
}

export function useCategories() {
  return useQuery({
    queryKey: productKeys.categories,
    queryFn: productApi.categories,
    staleTime: REFERENCE_STALE_TIME,
  });
}

export function useDoughTypes() {
  return useQuery({
    queryKey: productKeys.doughTypes,
    queryFn: productApi.doughTypes,
    staleTime: REFERENCE_STALE_TIME,
  });
}

export function useIngredients() {
  return useQuery({
    queryKey: productKeys.ingredients,
    queryFn: productApi.ingredients,
    staleTime: REFERENCE_STALE_TIME,
  });
}

export function useProducts(filters: ProductFilters) {
  return useQuery({
    queryKey: productKeys.list(filters),
    queryFn: () => productApi.list(filters),
    // Keeps the previous page visible while the next one loads, so the grid
    // does not collapse to a spinner on every filter change.
    placeholderData: keepPreviousData,
  });
}

export function useProduct(slug: string) {
  return useQuery({
    queryKey: productKeys.detail(slug),
    queryFn: () => productApi.get(slug),
    enabled: !!slug,
  });
}

export function useRecommendations() {
  return useQuery({
    queryKey: productKeys.recommendations,
    queryFn: productApi.recommendations,
    staleTime: REFERENCE_STALE_TIME,
  });
}

export function useFavorites() {
  const { data: user } = useCurrentUser();
  return useQuery({
    queryKey: productKeys.favorites,
    queryFn: productApi.favorites,
    enabled: !!user,
  });
}

export function useToggleFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, isFavorite }: { productId: string; isFavorite: boolean }) =>
      isFavorite ? productApi.removeFavorite(productId) : productApi.addFavorite(productId),
    onSuccess: () => qc.invalidateQueries({ queryKey: productKeys.favorites }),
  });
}
