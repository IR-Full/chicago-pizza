import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';

/**
 * One id that follows a request across the whole stack.
 *
 * Six services and a broker in between: a customer reporting "checkout said
 * something went wrong at 14:32" meant grepping six log streams by timestamp
 * and hoping. The gateway mints an id per request, carries it in the RabbitMQ
 * payload, and every service logs it — so one grep returns the whole story.
 *
 * `AsyncLocalStorage` rather than a parameter threaded through every call:
 * the id is ambient context, and putting it in every signature would be a
 * change to every function for the benefit of the log line at the end.
 */
export const CORRELATION_ID_HEADER = 'x-request-id';

const storage = new AsyncLocalStorage<string>();

/** Runs `fn` with `id` visible to everything it awaits. */
export function withCorrelationId<T>(id: string, fn: () => T): T {
  return storage.run(id, fn);
}

/** The id of the request being handled, if there is one. */
export function currentCorrelationId(): string | undefined {
  return storage.getStore();
}

/**
 * Accepts an id supplied by the caller so a trace can span the reverse proxy
 * and the browser, but only when it looks like one we minted: an unbounded
 * client-controlled string ends up in log files and, from there, in whatever
 * reads them.
 */
export function normaliseCorrelationId(candidate: unknown): string {
  return typeof candidate === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(candidate) ? candidate : randomUUID();
}
