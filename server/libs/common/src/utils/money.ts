/**
 * All money is stored in kopecks (1 RUB = 100 kopecks) to avoid float rounding
 * errors. Only these two conversions live here — currency *formatting* is the
 * client's job, where it can follow the locale the visitor chose.
 */
export const rublesToKopecks = (rubles: number): number => Math.round(rubles * 100);
export const kopecksToRubles = (kopecks: number): number => Math.round(kopecks) / 100;
