import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PaginationDto, paginate } from './pagination.dto';

const transform = (raw: Record<string, unknown>) =>
  plainToInstance(PaginationDto, raw, { enableImplicitConversion: false });

describe('PaginationDto', () => {
  it('defaults to the first page of twenty', () => {
    const dto = transform({});

    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('coerces the query-string numbers Express hands over', () => {
    const dto = transform({ page: '3', limit: '50' });

    expect(dto.page).toBe(3);
    expect(dto.limit).toBe(50);
    expect(validateSync(dto)).toHaveLength(0);
  });

  it.each([
    ['page below one', { page: '0' }],
    ['negative page', { page: '-2' }],
    ['limit below one', { limit: '0' }],
    ['limit above the cap', { limit: '101' }],
    ['fractional page', { page: '1.5' }],
  ])('rejects %s', (_label, raw) => {
    expect(validateSync(transform(raw)).length).toBeGreaterThan(0);
  });

  it('accepts the maximum allowed limit', () => {
    expect(validateSync(transform({ limit: '100' }))).toHaveLength(0);
  });

  describe('skip', () => {
    it.each([
      [1, 20, 0],
      [2, 20, 20],
      [5, 10, 40],
    ])('page %s of %s skips %s rows', (page, limit, expected) => {
      const dto = transform({ page: String(page), limit: String(limit) });
      expect(dto.skip).toBe(expected);
    });
  });
});

describe('paginate', () => {
  it('wraps a page of rows with its navigation metadata', () => {
    const dto = transform({ page: '2', limit: '10' });

    expect(paginate(['a', 'b'], 25, dto)).toEqual({
      items: ['a', 'b'],
      total: 25,
      page: 2,
      limit: 10,
      totalPages: 3,
    });
  });

  it('rounds the page count up so the tail page is reachable', () => {
    const dto = transform({ limit: '20' });
    expect(paginate([], 21, dto).totalPages).toBe(2);
  });

  it('reports zero pages for an empty collection', () => {
    expect(paginate([], 0, transform({})).totalPages).toBe(0);
  });

  it('accepts the plain {page, limit} the microservices pass over RabbitMQ', () => {
    expect(paginate(['a'], 7, { page: 2, limit: 3 })).toEqual({
      items: ['a'],
      total: 7,
      page: 2,
      limit: 3,
      totalPages: 3,
    });
  });
});
