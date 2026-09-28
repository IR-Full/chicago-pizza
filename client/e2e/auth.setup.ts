import { expect, test as setup } from '@playwright/test';
import { CUSTOMER, CUSTOMER_STATE } from './customer';

/**
 * Signs the seeded demo customer in once per run and saves the session for
 * the specs that need one.
 *
 * `POST /api/auth/login` is throttled at ten requests a minute per IP —
 * deliberately, it is the endpoint a password guesser would hammer. Four
 * checkout tests each driving the login form meant four of those ten were
 * spent before any of them tested anything, and a second run inside the same
 * minute started getting 429s that surfaced as "timed out waiting for
 * navigation" somewhere unrelated. Signing in once and handing the cookies
 * round costs one.
 *
 * The specs that are *about* signing in — the guest-basket merge here, and
 * the login tests in `smoke.spec.ts` — deliberately do not use this state.
 */
setup('authenticate the demo customer', async ({ page }) => {
  await page.goto('/login');
  // The click is only wired up once React has attached to the server-rendered
  // form; before that it is swallowed and no request is ever sent.
  await page.waitForLoadState('networkidle');

  const posted = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/auth/login' &&
      response.request().method() === 'POST',
    { timeout: 20_000 },
  );

  await page.getByLabel('Email').fill(CUSTOMER.email);
  await page.getByLabel(/^пароль$/i).fill(CUSTOMER.password);
  await page.getByRole('button', { name: /^войти$/i }).click();

  // Checked here so that a refusal is reported as itself — a lockout or a
  // 429 — rather than as a missing button further down.
  const response = await posted;
  expect(
    response.status(),
    `sign-in refused: ${response.status()} ${(await response.text()).slice(0, 200)}`,
  ).toBeLessThan(400);

  await expect(page.getByRole('button', { name: 'Выйти' })).toBeVisible({ timeout: 15_000 });

  await page.context().storageState({ path: CUSTOMER_STATE });
});
