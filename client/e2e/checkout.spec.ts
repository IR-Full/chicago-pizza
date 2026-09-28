import { expect, test, type Page } from '@playwright/test';
import { CUSTOMER, CUSTOMER_STATE } from './customer';

/**
 * The checkout path, end to end, against a real stack (`docker compose up`
 * with `SEED_ON_START=true`).
 *
 * Checkout had a thousand lines of unit tests and not one run that went from
 * the menu to a placed order. Those tests all mock the API, so every one of
 * them would still pass if the gateway renamed a field, the cart service
 * stopped clearing the basket, or the order page asked for the wrong route —
 * the failures that actually cost a customer their order.
 *
 * What these assert is mostly *agreement between screens*: the price the
 * constructor quotes is the price the cart charges, which is the total the
 * order is stored with. Hardcoding the seed's numbers instead would only fail
 * when the menu was repriced, which is not a regression. The two constants
 * that are pinned — the flat delivery fee and the free-delivery threshold —
 * are business rules from `libs/common/src/config/business.ts`, and the point
 * of pinning them is that four places used to disagree about them.
 */

/*
 * The seeded demo customer (`CUSTOMER`) and the cookie jar the setup project
 * saves for it (`CUSTOMER_STATE`) both come from ./customer. The account
 * exists verified precisely so this file has one to sign into: checkout
 * refuses an unverified address, and the mail catcher that would carry a
 * verification code is a `dev`-profile container the CI stack does not start.
 */

/**
 * Reached by its own page rather than by hunting the grid: the menu paginates
 * and reorders, and "Пепперони" names both a pizza and a topping, so a
 * card-grid locator is one menu change away from picking something else.
 */
const PIZZA = { slug: 'pepperoni-pizza', name: 'Пепперони' };

/** Flat delivery fee, in roubles, charged below `FREE_DELIVERY` — `DELIVERY_FEE`. */
const DELIVERY_FEE = 150;
/** Subtotal, in roubles, from which delivery stops being charged. */
const FREE_DELIVERY = 1000;

/**
 * 10% off, no minimum, and — the reason it exists rather than `WELCOME10` —
 * no per-user limit. A welcome offer is rightly once per customer, which
 * makes it good product and a bad fixture: the second run against a database
 * that kept its rows would be refused for having already been used, and the
 * failure would read as a broken promocode rather than a spent one.
 */
const PROMOCODE = 'E2EALWAYS10';

/**
 * The whole file shares one account, and that account has one basket in Redis.
 * Two tests signed in as it at the same time would clear each other's carts,
 * so they run in order — and only in one project, because two projects are
 * two workers and `mode: 'serial'` only orders tests within one of them.
 * CI runs `--project=chromium`, so nothing is lost there.
 */
test.describe.configure({ mode: 'serial' });

test.beforeEach(({}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'Shares the one seeded account; a second project would race its basket.',
  );
});

/** `630 ₽`, `1 260 ₽` → `630`, `1260`. The separator is a non-breaking space
 *  and the symbol's position is the locale's business, so read the digits. */
function roubles(text: string | null): number {
  const digits = (text ?? '').replace(/\D/g, '');
  expect(digits, `no price in ${JSON.stringify(text)}`).not.toBe('');
  return Number(digits);
}

/**
 * `toHaveURL` on its own path, ignoring the query.
 *
 * A bare `/\/checkout$/` is not anchored to the start, so it also matched
 * `/login?redirect=/checkout` — the assertion passed on the login page and
 * the test went on to look for checkout's heading without anything having
 * navigated at all.
 */
const atPath = (pathname: string) => (url: URL) => url.pathname === pathname;

/** Any single order's page. */
const atOrderPage = (url: URL) => /^\/orders\/[0-9a-f-]{36}$/.test(url.pathname);

/**
 * Fills and submits the sign-in form on whatever login URL is already open,
 * leaving where it lands to the page's own `redirect` handling.
 *
 * Submitted exactly once, and then the *response* is awaited rather than the
 * navigation. Both parts matter:
 *
 *  - Once, because a second sign-in while the first is in flight rotates the
 *    refresh token against itself, and the server's reuse detection then
 *    treats the pair as stolen and drops the session — the page sits on
 *    /login having successfully logged in twice. An earlier version of this
 *    helper retried the whole fill-and-click until the URL changed and hit
 *    exactly that, intermittently.
 *  - The response, because every way a sign-in can legitimately fail here
 *    says so in the reply. The account is locked out after enough failures,
 *    for instance, and a test that only watches the URL reports that as
 *    "timed out waiting for navigation" — which sends you looking at the
 *    wrong thing entirely.
 */
async function submitSignIn(page: Page) {
  const posted = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/auth/login' &&
      response.request().method() === 'POST',
    { timeout: 12_000 },
  );

  await page.getByLabel('Email').fill(CUSTOMER.email);
  await page.getByLabel(/^пароль$/i).fill(CUSTOMER.password);
  await page.getByRole('button', { name: /^войти$/i }).click();

  const response = await posted;
  expect(
    response.status(),
    `sign-in refused: ${response.status()} ${JSON.stringify(await response.text()).slice(0, 200)}`,
  ).toBeLessThan(400);

  await expect(page).not.toHaveURL(/\/login/, { timeout: 12_000 });
}

/**
 * Puts the page in the signed-in state the test starts from.
 *
 * The cookies come from the setup project rather than from driving the login
 * form, so the whole file costs one `/auth/login` instead of one per test —
 * see the note in ./auth.setup.ts. Signing in *through the UI* is still covered:
 * by the guest-basket test at the bottom of this file, which must start
 * signed out, and by smoke.spec.ts.
 */
async function signIn(page: Page) {
  await page.goto('/menu');
  await expect(page.getByRole('button', { name: 'Выйти' })).toBeVisible({ timeout: 15_000 });
}

/**
 * Empties the account's basket through the API rather than the UI.
 *
 * Auth is a cookie, and `page.request` shares the context's cookie jar, so
 * this needs no token handling. Doing it by hand would mean a remove click
 * per line — setup, not the thing under test.
 */
async function emptyCart(page: Page) {
  const response = await page.request.delete('/api/cart');
  expect(response.ok(), `DELETE /api/cart → ${response.status()}`).toBe(true);
}

/**
 * Builds the pizza in the constructor and adds it, returning the price the
 * constructor quoted — every later total is checked against this number.
 */
async function addPizzaToCart(page: Page, size: '45 см' | '50 см' | '60 см'): Promise<number> {
  await page.goto(`/menu/${PIZZA.slug}`);
  await page.getByRole('button', { name: 'Собрать' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: size, exact: true }).click();

  // The button carries the live price and is disabled until one arrives, so
  // waiting for it to be enabled is waiting for the pricing round-trip.
  const addButton = dialog.getByRole('button', { name: /добавить в корзину/i });
  await expect(addButton).toBeEnabled({ timeout: 15_000 });
  const quoted = roubles(await addButton.textContent());

  await addButton.click();
  await expect(dialog).toBeHidden();

  return quoted;
}

/**
 * The bold row under the divider, on whichever of the three summary cards is
 * on screen — the cart's, the checkout's and the order's are built the same
 * way.
 *
 * All three label it `cart.subtotal` ("Сумма"), the same string as the
 * subtotal row above, so the grand total is the last one. Reading the label
 * rather than a Tailwind class means restyling the card cannot quietly turn
 * these assertions into assertions about some other number.
 */
function grandTotal(page: Page) {
  return page.getByText('Сумма', { exact: true }).last().locator('..');
}

/**
 * The block of rows the grand total closes, on all three screens.
 *
 * Every row below is looked up inside this, because "Доставка" on its own is
 * not unique anywhere: the footer carries a tariff blurb ("Доставка 150 ₽ по
 * городу…") on every page, and `/checkout` also has a fulfilment button by
 * that name. Matching the page-wide last one found the footer and asserted
 * about marketing copy instead of the order.
 */
function summary(page: Page) {
  return grandTotal(page).locator('..');
}

/** The delivery line: a fee, "Бесплатно", or pickup's "Без платы за доставку". */
function deliveryRow(page: Page) {
  return summary(page).getByText('Доставка', { exact: true }).locator('..');
}

/** The discount line, which only exists once a code has been applied. */
function discountRow(page: Page) {
  return summary(page).getByText('Скидка', { exact: true }).locator('..');
}

/** The number on the header's cart button — its own span, so that an emptied
 *  basket cannot be satisfied by a count of 10. */
function cartCount(page: Page) {
  return page.getByRole('link', { name: 'Корзина' }).locator('span').last();
}

/**
 * Picks an address on the checkout screen, adding one only if the account has
 * none. Creating one unconditionally would leave a new address behind on
 * every run, and after a few runs "the first address" would stop meaning
 * anything.
 */
async function chooseDeliveryAddress(page: Page) {
  // Whether the account already has an address is a question for the API, not
  // for the DOM. `useAddresses` defaults to an empty list, so the card renders
  // its "Выберите адрес" empty state *while the query is still in flight* —
  // indistinguishable from having none. Both a bare `count()` and a wait for
  // "either a button or the empty state" therefore read "no addresses" from a
  // list that had simply not arrived, and added another "Дом" on every run
  // until "the first address" meant nothing at all.
  const existing = await page.request.get('/api/auth/addresses');
  expect(existing.ok(), `GET /api/auth/addresses → ${existing.status()}`).toBe(true);
  const hasAddress = ((await existing.json()) as unknown[]).length > 0;

  // The saved-address buttons are titled first, so the name begins with the title.
  const saved = page.getByRole('button', { name: /^Дом/ });

  if (hasAddress) {
    await saved.first().click();
    return;
  }

  await page.getByRole('button', { name: 'Новый адрес' }).click();
  await page.getByLabel('Название (Дом, Работа)').fill('Дом');
  await page.getByLabel('Улица').fill('пр. Имама Шамиля');
  await page.getByLabel('Дом', { exact: true }).fill('48');
  await page.getByRole('button', { name: 'Сохранить' }).click();

  await expect(saved.first()).toBeVisible({ timeout: 15_000 });
}

test.describe('checkout', () => {
  test.use({ storageState: CUSTOMER_STATE });

  test('a delivery order goes from the constructor to a placed order, and empties the basket', async ({
    page,
  }) => {
    await signIn(page);
    await emptyCart(page);

    const quoted = await addPizzaToCart(page, '50 см');
    // Below the threshold on purpose: a free delivery would assert nothing
    // about the tariff, and this is the case a customer actually meets.
    expect(quoted).toBeLessThan(FREE_DELIVERY);

    // ── The basket agrees with the constructor ──────────────────
    await page.goto('/cart');
    await expect(page.getByText(PIZZA.name)).toBeVisible();

    await expect(deliveryRow(page)).toContainText(String(DELIVERY_FEE));
    const cartTotal = roubles(await grandTotal(page).textContent());
    expect(cartTotal).toBe(quoted + DELIVERY_FEE);

    // ── Checkout agrees with the basket ─────────────────────────
    await page.getByRole('link', { name: 'Оформить заказ' }).click();
    await expect(page.getByRole('heading', { name: 'Оформление заказа' })).toBeVisible();

    await chooseDeliveryAddress(page);
    await expect(page.getByRole('button', { name: 'Доставка' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Как можно скорее' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('button', { name: 'Наличными курьеру' }).click();
    expect(roubles(await grandTotal(page).textContent())).toBe(cartTotal);

    // ── The order is stored with the same numbers ───────────────
    await page.getByRole('button', { name: 'Подтвердить заказ' }).click();

    await expect(page).toHaveURL(atOrderPage, { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: /Заказ №/ })).toBeVisible();
    await expect(page.getByText('Создан').first()).toBeVisible();
    await expect(page.getByText(PIZZA.name)).toBeVisible();
    expect(roubles(await grandTotal(page).textContent())).toBe(cartTotal);

    // ── Placing it consumed the basket ──────────────────────────
    // The line survived checkout once: the cart was read, priced and charged
    // but never cleared, so the next page load offered the same pizza again.
    await page.goto('/cart');
    await expect(page.getByRole('heading', { name: 'Корзина пуста' })).toBeVisible();
    await expect(cartCount(page)).toHaveText('0');
  });

  test('collecting the order in person is not charged for delivery', async ({ page }) => {
    await signIn(page);
    await emptyCart(page);

    const quoted = await addPizzaToCart(page, '45 см');

    await page.goto('/checkout');
    await page.getByRole('button', { name: 'Самовывоз' }).click();

    // A branch is preselected, so the customer who wants the nearest one taps
    // nothing. Whichever it is, it must be one the kitchen list actually
    // offers — the server re-checks that the branch can take the order.
    await expect(page.getByText('Выберите пиццерию')).toBeVisible();

    // Pickup is priced by the same rule the server applies: nobody drives, so
    // nobody pays. The fee is dropped rather than recomputed from the zone.
    await expect(page.getByText('Без платы за доставку')).toBeVisible();
    expect(roubles(await grandTotal(page).textContent())).toBe(quoted);

    await page.getByRole('button', { name: 'Подтвердить заказ' }).click();

    await expect(page).toHaveURL(atOrderPage, { timeout: 20_000 });
    await expect(deliveryRow(page)).toContainText('Бесплатно');
    expect(roubles(await grandTotal(page).textContent())).toBe(quoted);

    // No address on a collection — the order carries none, and the page must
    // not invent one.
    await expect(page.getByRole('heading', { name: 'Адрес доставки' })).toBeHidden();
  });

  test('a promocode discounts the order that is actually placed', async ({ page }) => {
    await signIn(page);
    await emptyCart(page);

    const quoted = await addPizzaToCart(page, '45 см');

    await page.goto('/checkout');
    // Collection, so the arithmetic is the discount and nothing else.
    await page.getByRole('button', { name: 'Самовывоз' }).click();

    await page.getByLabel('Промокод').fill(PROMOCODE);
    await page.getByRole('button', { name: 'Применить' }).click();

    const expectedDiscount = Math.round(quoted * 0.1);
    await expect(discountRow(page)).toContainText(String(expectedDiscount));
    expect(roubles(await grandTotal(page).textContent())).toBe(quoted - expectedDiscount);

    await page.getByRole('button', { name: 'Подтвердить заказ' }).click();

    // The discount has to survive the server's own re-pricing: the client's
    // numbers are never trusted, so this is the only check that the code was
    // redeemed rather than merely displayed.
    await expect(page).toHaveURL(atOrderPage, { timeout: 20_000 });
    await expect(discountRow(page)).toContainText(String(expectedDiscount));
    expect(roubles(await grandTotal(page).textContent())).toBe(quoted - expectedDiscount);
  });

  // The one test that has to arrive as a stranger: an empty jar, not the
  // shared one. It is also the only place the login form is driven here, and
  // so the only login this file spends.
  test.describe('from a cold browser', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('a basket filled without an account survives signing in', async ({
      page,
      playwright,
      baseURL,
    }) => {
      // The account's basket has to start empty or the total after the merge
      // would include whatever was left in it. Emptied over HTTP with the
      // saved cookies rather than by signing the page in first: this browser
      // must stay a stranger, and a UI sign-in here would spend one of the
      // ten logins a minute that /auth/login allows.
      const asCustomer = await playwright.request.newContext({
        baseURL,
        storageState: CUSTOMER_STATE,
      });
      try {
        const cleared = await asCustomer.delete('/api/cart');
        expect(cleared.ok(), `DELETE /api/cart → ${cleared.status()}`).toBe(true);
      } finally {
        await asCustomer.dispose();
      }

      const quoted = await addPizzaToCart(page, '45 см');
      await expect(cartCount(page)).toHaveText('1');

      // A guest is priced by the server too — the browser holds the lines,
      // never the amounts.
      await page.goto('/cart');
      expect(roubles(await grandTotal(page).textContent())).toBe(quoted + DELIVERY_FEE);

      // The basket sends them to sign in and says where to come back to — that
      // parameter is the whole reason the journey resumes at checkout rather
      // than dumping them on the menu with a basket they have to find again.
      await page.getByRole('link', { name: 'Войти и оформить' }).click();
      await expect(page).toHaveURL(
        (url) => url.pathname === '/login' && url.searchParams.get('redirect') === '/checkout',
      );

      await submitSignIn(page);

      // Signing in must hand the basket over, not discard it: the guest cart
      // is the reason an account is not demanded before the first pizza.
      await expect(page).toHaveURL(atPath('/checkout'), { timeout: 20_000 });
      await expect(page.getByRole('heading', { name: 'Оформление заказа' })).toBeVisible();
      await expect(page.getByText('Корзина пуста')).toBeHidden();
      expect(roubles(await grandTotal(page).textContent())).toBe(quoted + DELIVERY_FEE);
    });
  });
});
