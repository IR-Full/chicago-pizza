import type { ProductFilters } from './api';

/**
 * The catalog's state, as it appears in the URL.
 *
 * This exists so the server and the browser derive the *same* filter object
 * from the *same* request. That matters for two separate reasons:
 *
 *  - The page prefetches `productKeys.list(filters)` on the server and the
 *    widget subscribes to it in the browser. React Query matches queries by a
 *    structural hash of the key, so a single field parsed differently on the
 *    two sides is not an error — it is a silent cache miss, and the visitor
 *    pays for the same page of products twice.
 *  - A filter that lives in the URL is a filter someone can link to. The menu
 *    used to keep all of it in React state, so `/menu` was the only address
 *    the catalog ever had: no shareable link to the pizzas, no working back
 *    button, and nothing for a search engine to index beyond the unfiltered
 *    list.
 */

/** One screenful of cards on a laptop; the rest is a page away. */
export const CATALOG_PAGE_SIZE = 24;

/** Reads one query parameter. Abstracts over `URLSearchParams` and Next's
 *  plain `searchParams` record so both callers share the parsing below. */
export type ParamReader = (key: string) => string | null;

/** The boolean facets, and the parameter each is spelled with. */
export const CATALOG_FLAGS = {
  halal: 'isHalal',
  veg: 'isVegetarian',
  spicy: 'isSpicy',
  new: 'isNew',
  popular: 'isPopular',
} as const satisfies Record<string, keyof ProductFilters>;

export type CatalogFlagParam = keyof typeof CATALOG_FLAGS;

export function readerFromRecord(
  params: Record<string, string | string[] | undefined>,
): ParamReader {
  return (key) => {
    const value = params[key];
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
  };
}

export function readerFromSearchParams(params: URLSearchParams): ParamReader {
  return (key) => params.get(key);
}

/**
 * Turns the URL into the filter object the API and the query key both use.
 *
 * A flag is only sent when it is actually on: `false` would ask the API to
 * exclude everything that merely is not spicy. The properties are therefore
 * left `undefined` rather than set to `false`, which also keeps the query key
 * stable — React Query hashes keys with `JSON.stringify`, and that drops
 * `undefined` entirely.
 */
export function parseCatalogParams(get: ParamReader): ProductFilters {
  const filters: ProductFilters = {
    page: parsePage(get('page')),
    limit: CATALOG_PAGE_SIZE,
  };

  const category = get('category')?.trim();
  if (category) filters.categorySlug = category;

  const search = get('q')?.trim();
  if (search) filters.search = search;

  for (const [param, field] of Object.entries(CATALOG_FLAGS)) {
    if (isTruthyFlag(get(param))) filters[field] = true;
  }

  return filters;
}

/**
 * A page number out of the URL is untrusted input: `?page=abc`, `?page=0` and
 * `?page=-1` all used to reach the API. Anything unparseable is page one.
 */
function parsePage(raw: string | null): number {
  const page = Number(raw);
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

function isTruthyFlag(raw: string | null): boolean {
  return raw === '1' || raw === 'true';
}

/** Whether anything is narrowing the list — drives the "reset" button. */
export function hasActiveCatalogFilters(filters: ProductFilters): boolean {
  return Boolean(
    filters.search ||
      filters.isHalal ||
      filters.isVegetarian ||
      filters.isSpicy ||
      filters.isNew ||
      filters.isPopular,
  );
}
