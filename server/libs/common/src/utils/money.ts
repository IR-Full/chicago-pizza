/** All money is stored in kopecks (1 RUB = 100 kopecks) to avoid float rounding errors. */
export const rublesToKopecks = (rubles: number): number => Math.round(rubles * 100);
export const kopecksToRubles = (kopecks: number): number => Math.round(kopecks) / 100;

export function formatRub(kopecks: number): string {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(
    kopecksToRubles(kopecks),
  );
}
