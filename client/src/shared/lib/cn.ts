import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * The design system adds two radii of its own (`rounded-card`, `rounded-blob`).
 * tailwind-merge only dedupes utilities it recognises, so without this
 * extension a `rounded-full` override would land *next to* a component's
 * default `rounded-card` and the winner would depend on stylesheet order.
 */
const twMerge = extendTailwindMerge({
  extend: { theme: { borderRadius: ['card', 'blob'] } },
});

/** Merges conditional class names and resolves conflicting Tailwind utilities. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
