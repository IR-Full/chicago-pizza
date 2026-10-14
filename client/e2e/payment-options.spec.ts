import { expect, test } from '@playwright/test';
import { CUSTOMER_STATE } from './customer';

test.use({ storageState: CUSTOMER_STATE });

test('checkout exposes delivery and pickup payment options without touching the real cart', async ({
  page,
  baseURL,
}, testInfo) => {
  test.skip(!/^(localhost|127\.0\.0\.1)$/.test(new URL(baseURL!).hostname), 'Local preview only');
  // Only the cart is a fixture: this test must not change a customer's basket or create an order.
  await page.route('**/api/cart', (route) =>
    route.fulfill({
      json: {
        lines: [{ lineId: 'payment-preview', productName: 'Kinza' }],
        subtotal: 13000,
        itemCount: 1,
        deliveryFee: 15000,
        total: 28000,
        removed: [],
        freeDeliveryThreshold: 100000,
      },
    }),
  );
  await page.goto('/checkout');
  await expect(page.getByRole('button', { name: 'Наличными курьеру' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Картой курьеру' }).click();
  await expect(page.getByRole('button', { name: 'Картой курьеру' })).toHaveAttribute('aria-pressed', 'true');
  const capability = await (await page.request.get('/api/payments/enabled')).json();
  const online = page.getByRole('button', { name: 'Картой онлайн · ЮKassa' });
  if (!capability.enabled) await expect(online).toBeDisabled();
  for (const width of [320, 393, 980]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(online).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page
    .locator('.rounded-card')
    .filter({ has: page.getByRole('heading', { name: 'Оплата', exact: true }) })
    .screenshot({ path: testInfo.outputPath('checkout-payment-options.png') });
  await page.getByRole('button', { name: 'Самовывоз', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Наличными в пиццерии' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Картой в пиццерии' })).toBeVisible();
  // Exercise the configured-provider UI separately, using a declared API fixture, never a real charge.
  await page.route('**/api/payments/enabled', (route) => route.fulfill({ json: { enabled: true } }));
  await page.reload();
  await expect(online).toBeEnabled();
  await online.click();
  await expect(online).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(/Данные карты не поступают/)).toBeVisible();
});
