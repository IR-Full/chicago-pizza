import * as patterns from './patterns';

type PatternMap = Record<string, string>;

const groups: [string, PatternMap][] = (Object.entries(patterns) as [string, unknown][])
  .filter(
    ([, value]) =>
      typeof value === 'object' && value !== null && Object.values(value).every((v) => typeof v === 'string'),
  )
  .map(([name, value]) => [name, value as PatternMap]);

const entriesOf = (name: string) =>
  Object.entries((patterns as unknown as Record<string, PatternMap>)[name]).map(([key, value]) => ({ key, value }));

const requestGroups = groups.filter(([name]) => name.endsWith('_PATTERNS')).map(([name]) => name);

const allValues = groups.flatMap(([group, map]) =>
  Object.entries(map).map(([key, value]) => ({ group, key, value })),
);

/**
 * These strings are the wire contract between the gateway and every
 * microservice. A duplicate or a typo does not fail to compile — it silently
 * routes a message to the wrong handler (or to nobody), which is why the
 * whole table is asserted rather than spot-checked.
 */
describe('RabbitMQ message patterns', () => {
  it('exports a request group per microservice plus the event and queue tables', () => {
    expect(requestGroups.sort()).toEqual([
      'AUTH_PATTERNS',
      'NOTIFICATIONS_PATTERNS',
      'ORDERS_PATTERNS',
      'PRODUCTS_PATTERNS',
      'SUPPORT_PATTERNS',
    ]);
    expect(patterns.RMQ_EVENTS).toBeDefined();
    expect(patterns.RMQ_QUEUES).toBeDefined();
  });

  it('never repeats a pattern string', () => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];

    for (const { group, key, value } of allValues) {
      const previous = seen.get(value);
      if (previous) duplicates.push(`${value} (${previous} and ${group}.${key})`);
      else seen.set(value, `${group}.${key}`);
    }

    expect(duplicates).toEqual([]);
  });

  it('keeps every request pattern lowercase and dot-namespaced', () => {
    const offenders = requestGroups
      .flatMap((name) => entriesOf(name).map(({ key, value }) => ({ group: name, key, value })))
      .filter(({ value }) => !/^[a-z]+(\.[a-z0-9_]+)+$/.test(value));

    expect(offenders).toEqual([]);
  });

  it.each([
    ['AUTH_PATTERNS', 'auth'],
    ['PRODUCTS_PATTERNS', 'products'],
    ['ORDERS_PATTERNS', 'orders'],
    ['SUPPORT_PATTERNS', 'support'],
    ['NOTIFICATIONS_PATTERNS', 'notifications'],
  ])('routes all of %s under the %s prefix', (group, prefix) => {
    const offenders = entriesOf(group).filter(({ value }) => !value.startsWith(`${prefix}.`));

    expect(offenders).toEqual([]);
  });

  it('names events after the thing that happened, not the service that emits it', () => {
    // Events are deliberately cross-domain (auth emits `user.registered`,
    // orders emits `order.created`), so they are only held to the shape rule.
    const offenders = entriesOf('RMQ_EVENTS').filter(({ value }) => !/^[a-z]+(\.[a-z0-9_]+)+$/.test(value));

    expect(offenders).toEqual([]);
    expect(patterns.RMQ_EVENTS.ORDER_CREATED).toBe('order.created');
    expect(patterns.RMQ_EVENTS.USER_REGISTERED).toBe('user.registered');
  });

  it('gives every service exactly one queue', () => {
    const queues = Object.values(patterns.RMQ_QUEUES);

    expect(new Set(queues).size).toBe(queues.length);
    expect(queues.every((queue) => queue.endsWith('_queue'))).toBe(true);
  });

  it('exposes the auth calls the gateway depends on', () => {
    expect(patterns.AUTH_PATTERNS.LOGIN).toBe('auth.login');
    expect(patterns.AUTH_PATTERNS.REFRESH).toBe('auth.refresh');
    expect(Object.values(patterns.AUTH_PATTERNS)).toContain('auth.register');
  });

  it('holds only non-trivial strings', () => {
    for (const { value } of allValues) {
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(3);
    }
  });
});
