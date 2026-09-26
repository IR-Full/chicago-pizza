/**
 * How many extras may go on one pizza.
 *
 * Mirrors `MAX_ADDED_INGREDIENTS` in
 * `server/libs/common/src/validation/rules.ts` — keep the two in step. The
 * menu carries twenty ingredients, so this is reachable by an enthusiastic
 * customer, and the API answers 400 past it.
 */
export const MAX_ADDED_INGREDIENTS = 15;
