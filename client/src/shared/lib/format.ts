/** Prices travel over the wire in kopecks; never render them raw. */
export function formatPrice(kopecks: number, locale = 'ru-RU'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0,
  }).format(kopecks / 100);
}

export function formatDateTime(value: string | Date, locale = 'ru-RU'): string {
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function formatTime(value: string | Date, locale = 'ru-RU'): string {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

/** Short human-facing order number derived from the UUID. */
export function orderNumber(orderId: string): string {
  return orderId.slice(0, 8).toUpperCase();
}
