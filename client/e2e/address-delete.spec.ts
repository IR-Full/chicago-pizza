import { expect, test } from '@playwright/test';
import { randomInt, randomUUID } from 'node:crypto';

test('deleting saved delivery addresses preserves orders and rejects reuse', async ({
  page,
  baseURL,
  playwright,
}, testInfo) => {
  test.skip(!process.env.MAILHOG_URL, 'Requires local MailHog');
  expect(new URL(baseURL!).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
  expect(new URL(process.env.MAILHOG_URL!).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
  test.setTimeout(120000);
  const email = `address-review-${Date.now()}@example.test`;
  const password = 'AddressReview123!';
  const registered = await page.request.post('/api/auth/register', {
    data: {
      email,
      password,
      firstName: 'Проверка адресов',
      phone: `+79${randomInt(100_000_000, 1_000_000_000)}`,
      acceptPrivacyPolicy: true,
    },
  });
  expect(registered.ok(), await registered.text()).toBe(true);
  let code = '';
  await expect
    .poll(
      async () => {
        const messages = await (await page.request.get(`${process.env.MAILHOG_URL}/api/v2/messages`)).json();
        const message = messages.items.find((item: { Content: { Headers: Record<string, string[]> } }) =>
          item.Content.Headers.To?.some((to) => to.includes(email)),
        );
        code = message?.Content.Body.replace(/=\r?\n/g, '').match(/>(\d{6})</)?.[1] ?? '';
        return code;
      },
      { timeout: 30000 },
    )
    .toMatch(/^\d{6}$/);
  expect((await page.request.post('/api/auth/verify-email', { data: { email, code } })).ok()).toBe(true);
  expect((await page.request.post('/api/auth/login', { data: { email, password } })).ok()).toBe(true);
  async function address(title: string, isDefault: boolean) {
    const response = await page.request.post('/api/auth/addresses', {
      data: { title, city: 'Махачкала', street: 'Тестовая', house: '1', isDefault },
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  }
  const first = await address('Для заказа', true);
  const second = await address('Запасной', false);
  const product = await (await page.request.get('/api/products/kinza')).json();
  async function addItem() {
    const response = await page.request.post('/api/cart/items', {
      data: { config: { productId: product.id, variantId: product.variants[0].id }, quantity: 1 },
    });
    expect(response.ok(), await response.text()).toBe(true);
  }
  await addItem();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(13, 0, 0, 0);
  const payload = {
    addressId: first.id,
    deliveryType: 'SCHEDULED',
    scheduledAt: tomorrow.toISOString(),
    paymentMethod: 'CASH_ON_DELIVERY',
    comment: 'LOCAL ADDRESS DELETE VERIFICATION — test order',
  };
  const placed = await page.request.post('/api/orders', {
    data: payload,
    headers: { 'Idempotency-Key': randomUUID() },
  });
  expect(placed.ok(), await placed.text()).toBe(true);
  const order = await placed.json();
  await addItem();
  await page.setViewportSize({ width: 393, height: 850 });
  await page.goto('/checkout');
  await page.getByRole('button', { name: 'Удалить адрес «Для заказа»', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.screenshot({ path: testInfo.outputPath('delete-address-dialog.png') });
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
  expect((await (await page.request.get('/api/auth/addresses')).json()).length).toBe(2);
  await page.getByRole('button', { name: 'Удалить адрес «Для заказа»', exact: true }).click();
  await dialog.getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Удалить адрес «Для заказа»', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Запасной/ })).toHaveClass(/border-primary/);
  const remaining = await (await page.request.get('/api/auth/addresses')).json();
  expect(remaining.map((item: { id: string }) => item.id)).toEqual([second.id]);
  expect(remaining[0].isDefault).toBe(true);
  const history = await (await page.request.get(`/api/orders/${order.id}`)).json();
  expect(history.address.street).toBe('Тестовая');
  expect(history.address.id).toBe(first.id);
  expect((await page.request.delete(`/api/auth/addresses/${first.id}`)).ok()).toBe(true);
  const rejected = await page.request.post('/api/orders', {
    data: payload,
    headers: { 'Idempotency-Key': randomUUID() },
  });
  expect(rejected.status()).toBe(404);
  const other = await playwright.request.newContext({ baseURL });
  expect(
    (
      await other.post('/api/auth/login', {
        data: { email: 'admin@chicago-pizza.ru', password: 'Admin123!' },
      })
    ).ok(),
  ).toBe(true);
  expect((await other.delete(`/api/auth/addresses/${second.id}`)).status()).toBe(404);
  await other.dispose();
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Удалить адрес «Запасной»', exact: true }).click();
  await dialog.getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(page.getByText('Адресов пока нет')).toBeVisible();
  await page.goto(`/orders/${order.id}`);
  await expect(page.getByText(/Тестовая/)).toBeVisible();
});
