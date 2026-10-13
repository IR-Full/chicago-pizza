import type { ProductFilters } from './api';

/**
 * React Query keys for the catalog.
 *
 * Deliberately in their own module, with no `'use client'` directive, because
 * the server needs them too: `/menu` prefetches `list(filters)` during the
 * server render and the widget subscribes to the same key in the browser.
 *
 * They used to live in `queries.ts`, which *is* a client module — and importing
 * a value out of a client module from a Server Component does not give you the
 * value. React hands back a client-reference proxy instead, so `productKeys.list`
 * was not a function and the whole page render threw at runtime. Nothing in a
 * unit test can see that: vitest resolves the real module, because there is no
 * RSC boundary in a jsdom render. It only shows up in a real server render.
 */
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
