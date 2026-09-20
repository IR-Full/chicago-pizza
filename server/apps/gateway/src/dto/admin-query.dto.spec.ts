import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AdminOrderQueryDto, AdminTicketQueryDto, AdminUserQueryDto } from './admin.dto';

const check = <T extends object>(Dto: new () => T, query: Record<string, unknown>) => {
  const instance = plainToInstance(Dto, query, { enableImplicitConversion: false });
  return { instance, errors: validateSync(instance, { whitelist: true }) };
};

/**
 * These list endpoints used to read the query string as raw text and pass
 * `Number(page)` straight into Prisma's `skip`/`take`: `?limit=1000000` asked
 * Postgres for a million rows, `?page=abc` became `NaN`. The bounds live in
 * `PaginationDto` — these tests make sure the admin queries actually inherit
 * them rather than quietly drifting back to strings.
 */
describe('admin list queries — pagination bounds', () => {
  it('defaults to the first page of twenty', () => {
    const { instance, errors } = check(AdminOrderQueryDto, {});

    expect(errors).toHaveLength(0);
    expect(instance).toMatchObject({ page: 1, limit: 20 });
  });

  it('coerces numeric strings, because a query string has no numbers', () => {
    const { instance, errors } = check(AdminOrderQueryDto, { page: '3', limit: '50' });

    expect(errors).toHaveLength(0);
    expect(instance).toMatchObject({ page: 3, limit: 50 });
  });

  it.each([
    ['a page that is not a number', { page: 'abc' }],
    ['page zero', { page: '0' }],
    ['a negative page', { page: '-1' }],
    ['a limit past the cap', { limit: '1000000' }],
    ['a limit of zero', { limit: '0' }],
  ])('rejects %s', (_label, query) => {
    const { errors } = check(AdminOrderQueryDto, query);

    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts a known order status and rejects an invented one', () => {
    expect(check(AdminOrderQueryDto, { status: 'PREPARING' }).errors).toHaveLength(0);
    expect(check(AdminOrderQueryDto, { status: 'BURNT' }).errors.length).toBeGreaterThan(0);
  });

  it('accepts a known ticket status and rejects an invented one', () => {
    expect(check(AdminTicketQueryDto, { status: 'OPEN' }).errors).toHaveLength(0);
    expect(check(AdminTicketQueryDto, { status: 'SOMEDAY' }).errors.length).toBeGreaterThan(0);
  });

  it('bounds the user search so it cannot be used to push megabytes through', () => {
    expect(check(AdminUserQueryDto, { search: 'амина' }).errors).toHaveLength(0);
    expect(check(AdminUserQueryDto, { search: 'x'.repeat(101) }).errors.length).toBeGreaterThan(0);
  });
});
