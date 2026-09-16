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

    // The seed ships nine pizzas; at least one card must appear.
    await expect(page.getByRole('heading', { name: 'Пепперони' })).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Напитки' }).click();
    await expect(page.getByRole('heading', { name: /Coca-Cola/ })).toBeVisible();
  });

  test('search finds a pizza by ingredient', async ({ page }) => {
    await page.goto('/menu');

    await page.getByLabel(/поиск|search/i).fill('шампиньоны');

    // Mushroom pizzas contain шампиньоны even though the name does not.
    await expect(page.getByRole('heading', { name: 'Грибная' })).toBeVisible({ timeout: 15_000 });
  });

  test('pizza constructor shows a live price that reacts to size', async ({ page }) => {
    await page.goto('/menu');

    await page
      .locator('article, div')
      .filter({ hasText: 'Пепперони' })
      .getByRole('button', { name: /собрать|customize/i })
      .first()
      .click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const addButton = dialog.getByRole('button', { name: /добавить в корзину|add to cart/i });
    await expect(addButton).toContainText('₽');

    const priceAt30 = await addButton.textContent();
    await dialog.getByRole('button', { name: '45 см' }).click();

    // A larger pizza must cost more — this catches a broken pricing call.
    await expect(addButton).not.toHaveText(priceAt30 ?? '');
  });

  test('cart requires signing in', async ({ page }) => {
    await page.goto('/cart');

    await expect(page.getByRole('link', { name: /войти|sign in/i }).first()).toBeVisible();
  });

  test('theme toggle switches to dark mode', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: /тёмная|светлая|dark|light/i }).first().click();

    await expect(page.locator('html')).toHaveClass(/dark/);
  });
});

test.describe('authentication', () => {
  test('rejects an invalid login with an error message', async ({ page }) => {
    await page.goto('/login');

    await page.getByLabel('Email').fill('nobody@example.com');
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
