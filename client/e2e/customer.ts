/**
 * The account the end-to-end run signs in as, and where its session is kept.
 *
 * A plain module rather than something exported from `auth.setup.ts`:
 * Playwright refuses to let one test file import another, and the setup is
 * itself a test file.
 */

/**
 * The seeded demo customer. Created verified on purpose — checkout refuses an
 * unverified address, and the mail catcher that would carry a verification
 * code is a `dev`-profile container the CI stack does not start.
 *
 * Seeded only by `server/libs/prisma/src/seed.ts`, which is off unless
 * `SEED_ON_START=true` and is never run against a real deployment.
 */
export const CUSTOMER = { email: 'customer@chicago-pizza.ru', password: 'Customer123!' };

/**
 * Where `auth.setup.ts` saves the signed-in cookie jar for the specs that
 * need one. `test-results/` is already git-ignored.
 */
export const CUSTOMER_STATE = 'test-results/.auth/customer.json';
