import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ProductQueryDto } from './catalog.dto';

const parse = (raw: Record<string, unknown>) => plainToInstance(ProductQueryDto, raw);
const errorsFor = (raw: Record<string, unknown>) => validateSync(parse(raw) as object);

/**
 * Everything here arrives as a query string. The boolean coercion is the
 * subtle part: `?isVegetarian=false` must mean "only non-vegetarian", and an
 * omitted flag must stay undefined so it never becomes a filter at all.
 */
describe('ProductQueryDto — filters from the query string', () => {
  it('defaults to the first page of twenty', () => {
    const dto = parse({});

    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
    expect(errorsFor({})).toHaveLength(0);
  });

  it.each([['isVegetarian'], ['isSpicy'], ['isNew'], ['isPopular']])('reads %s=true as true', (flag) => {
    const dto = parse({ [flag]: 'true' }) as unknown as Record<string, unknown>;

    expect(dto[flag]).toBe(true);
  });

  it.each([['isVegetarian'], ['isSpicy'], ['isNew'], ['isPopular']])('reads %s=false as false', (flag) => {
    const dto = parse({ [flag]: 'false' }) as unknown as Record<string, unknown>;

    expect(dto[flag]).toBe(false);
  });

  it.each([['isVegetarian'], ['isSpicy'], ['isNew'], ['isPopular']])(
    'leaves %s undefined when it is absent',
    (flag) => {
      const dto = parse({}) as unknown as Record<string, unknown>;

      expect(dto[flag]).toBeUndefined();
    },
  );

  it('treats an empty value as "no filter" rather than false', () => {
    // `?isSpicy=` is what a cleared checkbox submits.
    expect((parse({ isSpicy: '' }) as unknown as Record<string, unknown>).isSpicy).toBeUndefined();
  });

  it('accepts a real boolean from a JSON client', () => {
    expect(parse({ isPopular: true }).isPopular).toBe(true);
    expect(parse({ isPopular: false }).isPopular).toBe(false);
  });

  it('treats any other spelling as false rather than truthy', () => {
    expect(parse({ isNew: 'да' }).isNew).toBe(false);
    expect(errorsFor({ isNew: 'да' })).toHaveLength(0);
  });

  it('coerces the pagination numbers', () => {
    const dto = parse({ page: '3', limit: '15' });

    expect(dto.page).toBe(3);
    expect(dto.limit).toBe(15);
    expect(validateSync(dto as object)).toHaveLength(0);
  });

  it.each([
    ['page zero', { page: '0' }],
    ['a limit above the cap', { limit: '101' }],
    ['an unknown product type', { type: 'SUSHI' }],
  ])('rejects %s', (_label, raw) => {
    expect(errorsFor(raw).length).toBeGreaterThan(0);
  });

  it('accepts a category slug, search term and product type together', () => {
    expect(errorsFor({ categorySlug: 'pizza', search: 'сыр', type: 'PIZZA' })).toHaveLength(0);
  });
});
