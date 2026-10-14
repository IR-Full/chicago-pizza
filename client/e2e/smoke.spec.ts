import { expect, test } from '@playwright/test';

/**
 * Smoke coverage of the guest journey. These run against a fully started
 * stack (docker compose up), so they exercise Nginx → gateway → microservices
 * → Postgres end to end rather than mocking the API.
 */

test.describe('guest journey', () => {
  test('home page renders the hero and seeded products', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: /заказать|order now/i }).first()).toBeVisible();
  });

  test('menu lists pizzas and filters by category', async ({ page }) => {
    await page.goto('/menu');

    // The menu ships twenty pizzas; at least one card must appear.
    await expect(page.getByRole('heading', { name: 'Пепперони' })).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Напитки' }).click();
    // Named in full: plain "Кола" also matches "Кола Добрый" and the locator would be ambiguous.
    await expect(page.getByRole('heading', { name: 'Кола Добрый' })).toBeVisible();
  });

  test('search finds a pizza by ingredient', async ({ page }) => {
    await page.goto('/menu');

    await page.getByLabel(/поиск|search/i).fill('шампиньоны');

    // Mushroom pizzas contain шампиньоны even though the name does not.
    await expect(page.getByRole('heading', { name: 'Грибная' })).toBeVisible({ timeout: 15_000 });
  });

  test('pizza constructor shows a live price that reacts to size', async ({ page }) => {
    await page.goto('/menu/pepperoni-pizza');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Собрать', exact: true }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const addButton = dialog.getByRole('button', { name: /добавить в корзину|add to cart/i });
    await expect(addButton).toContainText('₽');

    // The constructor opens on the smallest size, so the one to click is a
    // bigger one. It used to click 45 cm, which was the second size when the
    // menu ran 30/45/60 and is the *default* now that it runs 45/50/60 — the
    // click would have changed nothing and the assertion below would have
    // been comparing a price to itself.
    const priceAtSmallest = await addButton.textContent();
    await dialog.getByRole('button', { name: '60 см' }).click();

    // A larger pizza must cost more — this catches a broken pricing call.
    await expect(addButton).not.toHaveText(priceAtSmallest ?? '');
  });

  test('guest can open an empty cart and return to the menu', async ({ page }) => {
    await page.goto('/cart');
    await expect(page.getByRole('link', { name: /в меню|go to menu/i })).toBeVisible();
  });

  test('theme toggle switches to dark mode', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const menu = page.getByRole('button', { name: 'Меню', exact: true });
    if (await menu.isVisible()) await menu.click();

    await page
      .getByRole('button', { name: /тёмная|светлая|dark|light/i })
      .first()
      .click();

    await expect(page.locator('html')).toHaveClass(/dark/);
  });
});

test.describe('authentication', () => {
  test('rejects an invalid login with an error message', async ({ page }) => {
    await page.goto('/login');

    // A fresh address every run, not a fixed `nobody@example.com`.
    //
    // Failed sign-ins are counted per account (hashed email) in Redis and
    // lock it out for fifteen minutes past the limit — which is the right
    // behaviour, and made this test poison itself: each run left another
    // failure behind, and after a handful of runs the server answered
    // "слишком много неудачных попыток" instead of "неверный email или
    // пароль", so the assertion below failed on an app that was working
    // exactly as designed. An address nobody has tried before starts from
    // zero.
    const nobody = `nobody-${Date.now().toString(36)}@example.com`;

    await page.getByLabel('Email').fill(nobody);
    await page.getByLabel(/пароль|password/i).fill('WrongPassword1');
    await page.getByRole('button', { name: /^войти$|^sign in$/i }).click();

    await expect(page.getByText(/неверн|invalid/i)).toBeVisible({ timeout: 10_000 });
  });

  test('register form validates a weak password client-side', async ({ page }) => {
    await page.goto('/register');

    await page.getByLabel(/^имя$|^first name$/i).fill('Тест');
    await page.getByLabel('Email').fill('test@example.com');
    await page.getByLabel(/^пароль$|^password$/i).fill('weak');
    await page.getByRole('button', { name: /зарегистрироваться|create account/i }).click();

    await expect(page.getByRole('alert').first()).toBeVisible();
  });
});
