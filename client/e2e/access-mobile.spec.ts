import { expect, test } from '@playwright/test';
import { CUSTOMER } from './customer';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => console.log(`Browser error: ${error.message}`));
  page.on('requestfailed', (request) =>
    console.log(`Request failed: ${new URL(request.url()).pathname}: ${request.failure()?.errorText}`),
  );
});

test('guest admin access offers login and preserves the requested section', async ({ page }) => {
  await page.goto('/admin/users');
  await expect(page).toHaveURL(/\/login\?redirect=%2Fadmin%2Fusers/, { timeout: 15000 });
  await expect(page.getByRole('heading', { name: 'Вход', exact: true })).toBeVisible();
});

test('customer gets a clear access message instead of a bare 403', async ({ page, baseURL }) => {
  expect(new URL(baseURL!).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
  const login = await page.request.post('/api/auth/login', { data: CUSTOMER });
  expect(login.ok(), await login.text()).toBe(true);
  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { name: 'Нет доступа к этому разделу', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Вернуться в меню', exact: true })).toBeVisible();
  expect((await page.request.get('/api/admin/users')).status()).toBe(403);
});

test('registration inputs stay readable without iOS focus zoom in portrait and landscape', async ({
  page,
}) => {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/register');
    const inputs = page.locator('main input:not([type="checkbox"])');
    expect(await inputs.count()).toBeGreaterThan(0);
    for (const input of await inputs.all()) {
      await input.focus();
      expect(
        await input.evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
      ).toBeGreaterThanOrEqual(16);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
});
