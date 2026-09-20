import type { NextFunction, Request, Response } from 'express';
import {
  CORRELATION_ID_HEADER,
  currentCorrelationId,
  normaliseCorrelationId,
  withCorrelationId,
} from './correlation';
import { CorrelationIdMiddleware } from './correlation.middleware';

/**
 * Six services with a broker between them: "checkout failed at 14:32" used to
 * mean grepping six log streams by timestamp and hoping. One id, carried all
 * the way through, turns that into a single grep.
 */
describe('correlation scope', () => {
  it('is visible to everything running inside it', () => {
    withCorrelationId('abc-123', () => {
      expect(currentCorrelationId()).toBe('abc-123');
    });
  });

  it('survives an await, which is the entire point', async () => {
    await withCorrelationId('abc-123', async () => {
      await Promise.resolve();
      expect(currentCorrelationId()).toBe('abc-123');
    });
  });

  it('does not leak out of its scope', () => {
    withCorrelationId('abc-123', () => undefined);

    expect(currentCorrelationId()).toBeUndefined();
  });

  it('keeps two concurrent requests apart', async () => {
    const seen: string[] = [];

    await Promise.all([
      withCorrelationId('first', async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        seen.push(currentCorrelationId()!);
      }),
      withCorrelationId('second', async () => {
        seen.push(currentCorrelationId()!);
      }),
    ]);

    expect(seen.sort()).toEqual(['first', 'second']);
  });
});

describe('normaliseCorrelationId', () => {
  it('honours an id the caller supplied, so a trace can span the proxy', () => {
    expect(normaliseCorrelationId('edge-7f3a9b21')).toBe('edge-7f3a9b21');
  });

  it.each([
    ['nothing at all', undefined],
    ['an empty string', ''],
    ['something too short to be one of ours', 'abc'],
    ['an overlong string', 'x'.repeat(65)],
    ['a header array', ['a-valid-looking-id']],
    ['punctuation that has no business in a log line', 'id\nInjected: header'],
  ])('mints a fresh one for %s', (_label, candidate) => {
    const id = normaliseCorrelationId(candidate);

    // An unbounded client-controlled string ends up in log files and, from
    // there, in whatever reads them.
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('CorrelationIdMiddleware', () => {
  const run = (headers: Record<string, unknown>) => {
    const middleware = new CorrelationIdMiddleware();
    const setHeader = jest.fn();
    let insideScope: string | undefined;

    const next: NextFunction = () => {
      insideScope = currentCorrelationId();
    };

    middleware.use({ headers } as unknown as Request, { setHeader } as unknown as Response, next);
    return { setHeader, insideScope };
  };

  it('opens the scope before the request is handled', () => {
    const { insideScope } = run({ [CORRELATION_ID_HEADER]: 'edge-7f3a9b21' });

    expect(insideScope).toBe('edge-7f3a9b21');
  });

  it('echoes the id back so a customer can quote something exact', () => {
    const { setHeader, insideScope } = run({});

    expect(setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, insideScope);
  });

  it('replaces an id that does not look like one of ours', () => {
    const { insideScope } = run({ [CORRELATION_ID_HEADER]: 'nope\r\nX-Admin: true' });

    expect(insideScope).not.toContain('X-Admin');
  });
});
