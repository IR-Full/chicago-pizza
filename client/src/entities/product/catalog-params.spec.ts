import { describe, expect, it } from 'vitest';
import {
  CATALOG_PAGE_SIZE,
  hasActiveCatalogFilters,
  parseCatalogParams,
  readerFromRecord,
  readerFromSearchParams,
} from './catalog-params';

const fromQuery = (query: string) => parseCatalogParams(readerFromSearchParams(new URLSearchParams(query)));

describe('parseCatalogParams', () => {
  it('asks for a bounded first page by default', () => {
    expect(fromQuery('')).toEqual({ page: 1, limit: CATALOG_PAGE_SIZE });
  });

  it('reads the category and the search term', () => {
    expect(fromQuery('category=pizza&q=грибы')).toMatchObject({
      categorySlug: 'pizza',
      search: 'грибы',
    });
  });

  it('trims, and treats whitespace as absent', () => {
    expect(fromQuery('q=%20%20&category=%20%20')).toEqual({ page: 1, limit: CATALOG_PAGE_SIZE });
  });

  it('sets a flag only when it is on, never to false', () => {
    const filters = fromQuery('halal=1&veg=true');

    expect(filters.isHalal).toBe(true);
    expect(filters.isVegetarian).toBe(true);
    // Absent rather than `false`: `false` would ask the API to exclude
    // everything that merely is not spicy.
    expect('isSpicy' in filters).toBe(false);
    expect('isNew' in filters).toBe(false);
  });

  it('ignores a flag spelled with anything else', () => {
    const filters = fromQuery('halal=0&veg=no&spicy=');

    expect('isHalal' in filters).toBe(false);
    expect('isVegetarian' in filters).toBe(false);
    expect('isSpicy' in filters).toBe(false);
  });

  it('reads a page number', () => {
    expect(fromQuery('page=3').page).toBe(3);
  });

  it.each(['page=0', 'page=-2', 'page=abc', 'page=1.5', 'page='])(
    'falls back to the first page for ?%s',
    (query) => {
      expect(fromQuery(query).page).toBe(1);
    },
  );

  it('parses Next’s searchParams record the same way as a query string', () => {
    const fromRecord = parseCatalogParams(readerFromRecord({ category: 'drinks', halal: '1', page: '2' }));

    expect(fromRecord).toEqual(fromQuery('category=drinks&halal=1&page=2'));
  });

  it('takes the first value when a parameter is repeated', () => {
    // `?category=a&category=b` arrives as an array on the server.
    expect(parseCatalogParams(readerFromRecord({ category: ['pizza', 'drinks'] }))).toMatchObject({
      categorySlug: 'pizza',
    });
  });
});

describe('hasActiveCatalogFilters', () => {
  it('is false for a bare catalog', () => {
    expect(hasActiveCatalogFilters(fromQuery(''))).toBe(false);
  });

  it('is false for a category alone — that is navigation, not a filter', () => {
    expect(hasActiveCatalogFilters(fromQuery('category=pizza'))).toBe(false);
  });

  it('is false for a page alone', () => {
    expect(hasActiveCatalogFilters(fromQuery('page=4'))).toBe(false);
  });

  it.each(['q=сыр', 'halal=1', 'veg=1', 'spicy=1', 'new=1', 'popular=1'])('is true for ?%s', (query) => {
    expect(hasActiveCatalogFilters(fromQuery(query))).toBe(true);
  });
});
