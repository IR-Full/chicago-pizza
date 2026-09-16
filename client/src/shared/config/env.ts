/**
 * Browser code talks to the API through Nginx (`NEXT_PUBLIC_API_URL`).
 * Server Components run inside the compose network and can reach the gateway
 * directly (`INTERNAL_API_URL`), skipping the proxy hop.
 */
export const PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
export const PUBLIC_WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'http://localhost:4000';

export const INTERNAL_API_URL = process.env.INTERNAL_API_URL ?? PUBLIC_API_URL;

export const IS_SERVER = typeof window === 'undefined';

export function apiBaseUrl(): string {
  return IS_SERVER ? INTERNAL_API_URL : PUBLIC_API_URL;
}
