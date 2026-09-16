import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ProductQueryDto } from './product-query.dto';

const parse = (raw: Record<string, unknown>) => plainToInstance(ProductQueryDto, raw);
const errorsFor = (raw: Record<string, unknown>) => validateSync(parse(raw) as object);

describe('ProductQueryDto', () => {
  it('defaults to the first page of twenty', () => {
    const dto = parse({});

    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
    expect(errorsFor({})).toHaveLength(0);
  });

  it('accepts a fully specified query', () => {
    const errors = errorsFor({
      categorySlug: 'pizza',
      type: 'PIZZA',
      search: 'пепперони',
      isVegetarian: true,
      isSpicy: false,
      isNew: true,
      isPopular: false,
      page: 2,
      limit: 50,
    });

    expect(errors).toHaveLength(0);
  });

  it.each([['PIZZA'], ['SNACK'], ['DRINK'], ['DESSERT'], ['COMBO']])('accepts the %s product type', (type) => {
    expect(errorsFor({ type })).toHaveLength(0);
  });

  it('rejects a product type outside the enum', () => {
    expect(errorsFor({ type: 'SUSHI' }).length).toBeGreaterThan(0);
  });

  it('caps the search term so a huge string cannot be pushed into the cache key', () => {
    expect(errorsFor({ search: 'x'.repeat(100) })).toHaveLength(0);
    expect(errorsFor({ search: 'x'.repeat(101) }).length).toBeGreaterThan(0);
  });

  it.each([
    ['page zero', { page: 0 }],
    ['a negative page', { page: -1 }],
    ['a fractional page', { page: 1.5 }],
    ['limit zero', { limit: 0 }],
    ['a limit above the cap', { limit: 101 }],
  ])('rejects %s', (_label, raw) => {
    expect(errorsFor(raw).length).toBeGreaterThan(0);
  });

  it('coerces the numbers arriving as query strings', () => {
    const dto = parse({ page: '3', limit: '15' });

    expect(dto.page).toBe(3);
    expect(dto.limit).toBe(15);
    expect(validateSync(dto as object)).toHaveLength(0);
  });

  it('leaves absent flags undefined so they do not become filters', () => {
    const dto = parse({ categorySlug: 'pizza' });

    expect(dto.isVegetarian).toBeUndefined();
    expect(dto.isSpicy).toBeUndefined();
    expect(dto.isNew).toBeUndefined();
    expect(dto.isPopular).toBeUndefined();
  });
});
