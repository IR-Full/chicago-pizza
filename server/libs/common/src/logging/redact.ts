/**
 * Log lines are personal data too.
 *
 * Every request URL was being logged in full, and every outgoing email was
 * logged with its recipient — so `docker compose logs` held a list of
 * customer addresses, the tokens in their password-reset links, and whatever
 * they had typed into the catalog search. Logs are read by more people than
 * the database, kept for longer, and shipped to third parties without much
 * thought; they deserve the same restraint as the tables.
 *
 * Nothing here is reversible on purpose. The point is to keep enough to debug
 * — which address family, which endpoint, roughly which user — and no more.
 */

/**
 * `a***a@gmail.com`. Enough to recognise an address you already know,
 * useless for harvesting one you do not.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const visible = local.length <= 2 ? local.slice(0, 1) : `${local[0]}***${local[local.length - 1]}`;

  return `${visible}@${domain}`;
}

/** Query-string keys whose values must never reach a log file. */
const SENSITIVE_PARAMS = new Set(['token', 'code', 'email', 'phone', 'search', 'q', 'id']);

/**
 * Strips the values of sensitive query parameters, keeping the shape of the
 * request. `/api/auth/reset-password?token=abc` becomes
 * `/api/auth/reset-password?token=[redacted]` — still obvious what was
 * called, no longer a working password-reset link sitting in a log.
 */
export function redactUrl(url: string): string {
  const queryStart = url.indexOf('?');
  if (queryStart < 0) return url;

  const path = url.slice(0, queryStart);
  const redacted = url
    .slice(queryStart + 1)
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const [key, ...rest] = pair.split('=');
      if (!rest.length) return key;
      return SENSITIVE_PARAMS.has(key.toLowerCase()) ? `${key}=[redacted]` : pair;
    })
    .join('&');

  return redacted ? `${path}?${redacted}` : path;
}

/**
 * A short, stable handle for a user id — enough to follow one person through
 * a log file, not enough to identify them in it.
 */
export function shortId(id: string): string {
  return id.slice(0, 8);
}
