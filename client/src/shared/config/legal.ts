/**
 * Mirrors `server/libs/common/src/config/legal.ts` — keep the two in step.
 *
 * The server decides which version an account accepted; this copy exists so
 * the policy page can state the date it is showing. If they drift, the server
 * wins and every customer is asked to re-consent, which is the safe failure.
 */
export const PRIVACY_POLICY_VERSION = '2026-09-19';
