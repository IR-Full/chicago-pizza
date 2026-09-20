/**
 * The personal-data policy the customer agreed to.
 *
 * Stored as a version rather than a boolean on purpose: under 152-ФЗ the
 * consent covers the text that was shown at the time. When the policy
 * changes, bump this — everyone whose stored version is older has, in law,
 * not agreed to the new text, and the app can ask again instead of assuming.
 *
 * The client mirrors this in `src/shared/config/legal.ts`; the two must move
 * together, which is why the date is in the value and not only in a comment.
 */
export const PRIVACY_POLICY_VERSION = '2026-09-19';

/** True when a stored acceptance still covers the current policy text. */
export function consentIsCurrent(storedVersion: string | null | undefined): boolean {
  return storedVersion === PRIVACY_POLICY_VERSION;
}
