import { expect, test } from '@playwright/test';
import { io } from 'socket.io-client';
import type { PizzaConfig, Product } from '../src/shared/api/types';

// A local mail catcher is required. Never query a production mailbox or
// create accounts/orders against an external deployment with this test.
test('local registration, email verification, guest-cart merge and order', async ({ page, baseURL }) => {
  test.skip(!process.env.MAILHOG_URL, 'Requires local MailHog');
  expect(new URL(baseURL!).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
  expect(new URL(process.env.MAILHOG_URL!).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
  test.setTimeout(180_000);
  const email = `local-review-${Date.now()}@example.test`;
  const password = 'LocalReview123!';
  await page.goto('/menu/kinza');
  await page.getByRole('button', { name: 'В корзину', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const lemon = dialog.getByRole('button', { name: 'Лимон', exact: true });
  await lemon.click();
  await expect(lemon).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByAltText('Kinza — Лимон')).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Добавить в корзину/i })).toBeEnabled();
  await dialog.getByRole('button', { name: /Добавить в корзину/i }).click();
  await expect(dialog).toBeHidden();
  await page.goto('/menu/pepperoni-pizza');
  await page.getByRole('button', { name: 'Собрать', exact: true }).click();
  await dialog.getByRole('button', { name: /Добавить в корзину/i }).click();
  await expect(dialog).toBeHidden();

  await page.goto('/register');
  await page.getByLabel('Имя', { exact: true }).fill('Локальная проверка');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Зарегистрироваться', exact: true }).click();
  await expect(page).toHaveURL(/\/verify-email\?/);
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
      { timeout: 30_000 },
    )
    .toMatch(/^\d{6}$/);
  await page.locator('#code').fill(code);
  await page.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
  const cart = await (await page.request.get('/api/cart')).json();
  expect(cart.lines).toHaveLength(2);
  expect(cart.lines.find((line: { productName: string }) => line.productName === 'Kinza').variantName).toBe(
    'Лимон',
  );

  // Exercise account-cart writes for every product, including all flavours.
  const catalogue = (await (await page.request.get('/api/products?limit=100')).json()) as {
    items: Product[];
  };
  const doughs = await (await page.request.get('/api/dough-types')).json();
  let expectedLines = 0;
  for (const product of catalogue.items) {
    const configs: PizzaConfig[] =
      product.type === 'PIZZA'
        ? [{ productId: product.id, sizeCm: product.sizes[0].sizeCm, doughTypeId: doughs[0].id }]
        : product.variants.length
          ? product.variants.map((variant) => ({ productId: product.id, variantId: variant.id }))
          : [{ productId: product.id }];
    for (const config of configs) {
      const added = await page.request.post('/api/cart/items', { data: { config, quantity: 1 } });
      expect(added.ok(), `${product.name}: ${await added.text()}`).toBe(true);
      expectedLines++;
      // Keep the artificial API sweep within the normal local edge limit.
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  expect((await (await page.request.get('/api/cart')).json()).lines).toHaveLength(expectedLines);
  const cookie = (await page.context().cookies()).map((item) => `${item.name}=${item.value}`).join('; ');
  const socket = io(baseURL!, { transports: ['websocket'], extraHeaders: { Cookie: cookie } });
  page.on('close', () => socket.disconnect());
  let notified = false;
  socket.on('notification', () => {
    notified = true;
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Local WebSocket connection timed out')), 10_000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  await page.goto('/checkout');
  await page.getByRole('button', { name: 'Новый адрес', exact: true }).click();
  await page.getByLabel('Название (Дом, Работа)', { exact: true }).fill('Тестовый адрес');
  await page.getByLabel('Улица', { exact: true }).fill('пр. Имама Шамиля');
  await page.getByLabel('Дом', { exact: true }).fill('48');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Тестовый адрес/ })).toBeVisible();
  await page.getByRole('button', { name: 'Ко времени', exact: true }).click();
  const tomorrow = await page.evaluate(() => {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    date.setHours(13, 0, 0, 0);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  await page.locator('#scheduledAt').fill(tomorrow);
  await page.locator('#comment').fill('LOCAL CATALOG VERIFICATION — test order');
  const placed = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/orders' && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Подтвердить заказ', exact: true }).click();
  const response = await placed;
  expect(response.ok(), await response.text()).toBe(true);
  const order = await response.json();
  await expect(page).toHaveURL(new RegExp(`/orders/${order.id}`));
  await expect(page.getByRole('heading', { name: /Заказ №/ })).toBeVisible();
  const persisted = await (await page.request.get(`/api/orders/${order.id}`)).json();
  expect(
    persisted.items.find((item: { productName: string }) => item.productName === 'Kinza').variantName,
  ).toBe('Лимон');
  expect(persisted.items).toHaveLength(expectedLines);
  const kinza = catalogue.items.find((product) => product.slug === 'kinza')!;
  expect(
    persisted.items
      .filter((item: { productName: string }) => item.productName === 'Kinza')
      .map((item: { variantName: string }) => item.variantName)
      .sort(),
  ).toEqual(kinza.variants.map((variant) => variant.name).sort());
  expect((await (await page.request.get('/api/cart')).json()).lines).toEqual([]);
  await expect.poll(() => notified, { timeout: 30_000 }).toBe(true);
  socket.disconnect();
  console.log(
    `Registered and verified a new local customer; created delivery order ${order.id} with the selected Kinza flavour.`,
  );
});
