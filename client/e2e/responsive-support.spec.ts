import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

async function admin(page: Page, baseURL?: string) {
  expect(new URL(baseURL!).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
  const response = await page.request.post('/api/auth/login', {
    data: { email: 'admin@chicago-pizza.ru', password: 'Admin123!' },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

test('support replies survive concurrent retries without duplicate text rows', async ({ page, baseURL }) => {
  await admin(page, baseURL);
  const original = 'Здравствуйте! Пицца приехала холодной 🥤';
  const opened = await page.request.post('/api/support/tickets', {
    data: { subject: 'LOCAL REVIEW — проверка поддержки', message: original },
  });
  expect(opened.ok(), await opened.text()).toBe(true);
  const ticket = await opened.json();
  const message = 'Ответ оператора: уже разбираемся. Спасибо!';
  const clientMessageId = randomUUID();
  const endpoint = `/api/support/tickets/${ticket.id}/messages`;
  const replies = await Promise.all(
    Array.from({ length: 5 }, () =>
      page.request.post(endpoint, {
        data: { message, clientMessageId },
      }),
    ),
  );
  const ids: string[] = [];
  for (const reply of replies) {
    expect(reply.ok(), await reply.text()).toBe(true);
    ids.push((await reply.json()).id);
  }
  expect(new Set(ids).size).toBe(1);
  const repeated = await page.request.post(endpoint, { data: { message } });
  expect((await repeated.json()).id).toBe(ids[0]);
  const collision = await page.request.post(endpoint, { data: { message: 'Другой ответ', clientMessageId } });
  expect(collision.status()).toBe(409);
  const saved = await (await page.request.get(`/api/support/tickets/${ticket.id}`)).json();
  expect(saved.messages.map((item: { message: string }) => item.message)).toEqual([original, message]);
  const invalid = await page.request.post(endpoint, { data: { message: '\uFFFD\uFFFD' } });
  expect(invalid.status()).toBe(400);
  console.log('Cyrillic/emoji persisted exactly; five concurrent staff sends created one reply.');
});

test('public pages and every admin screen fit narrow and wide viewports', async ({ page, baseURL }) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(15_000);
  await admin(page, baseURL);
  // This test must also work alone against a fresh database: it cannot rely
  // on another parallel support test having already created a ticket.
  const subject = `LOCAL RESPONSIVE ${randomUUID()}`;
  const opened = await page.request.post('/api/support/tickets', {
    data: { subject, message: 'Проверка адаптивности переписки поддержки.' },
  });
  expect(opened.ok(), await opened.text()).toBe(true);
  const routes = [
    '/',
    '/menu',
    '/menu/kinza',
    '/cart',
    '/checkout',
    '/orders',
    '/profile',
    '/support',
    '/admin',
    '/admin/kitchen',
    '/admin/stop-list',
    '/admin/products',
    '/admin/analytics',
    '/admin/promocodes',
    '/admin/users',
    '/admin/tickets',
  ];
  const issues: string[] = [];
  for (const width of [320, 393, 768, 980, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of routes) {
      await page.goto(route);
      await page.waitForTimeout(300);
      await expect(page.locator('main .animate-pulse')).toHaveCount(0, { timeout: 15_000 });
      if (route === '/cart' || route === '/checkout') {
        await expect(page.getByText('Корзина пуста', { exact: true })).toBeVisible();
      } else {
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      }
      const clipped = await page.evaluate(() => {
        const outside: string[] = [];
        for (const element of document.querySelectorAll<HTMLElement>('button,input,select,textarea')) {
          const bounds = element.getBoundingClientRect();
          if (!bounds.width || !bounds.height) continue;
          let scrollable = false;
          for (let parent = element.parentElement; parent; parent = parent.parentElement) {
            if (['auto', 'scroll'].includes(getComputedStyle(parent).overflowX)) {
              scrollable = true;
              break;
            }
          }
          if (!scrollable && (bounds.left < -1 || bounds.right > innerWidth + 1)) {
            outside.push(
              element.getAttribute('aria-label') ??
                element.textContent?.trim().slice(0, 50) ??
                element.tagName,
            );
          }
        }
        return outside;
      });
      if (clipped.length) issues.push(`${route} at ${width}px: ${clipped.join(', ')}`);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
        `${route} at ${width}px overflows`,
      ).toBeLessThanOrEqual(1);
      if (route.startsWith('/admin')) {
        const navigation = page.getByRole('navigation', { name: 'Панель управления', exact: true });
        const tops = await navigation
          .getByRole('link')
          .evaluateAll((links) => links.map((link) => Math.round(link.getBoundingClientRect().top)));
        expect(new Set(tops).size).toBe(1);
      }
      if (route === '/admin/products') {
        await page.getByRole('button', { name: 'Изменить «Kinza»', exact: true }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        expect(
          await dialog.evaluate((element) => element.scrollWidth - element.clientWidth),
          `Product editor at ${width}px`,
        ).toBeLessThanOrEqual(1);
        await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
      }
      if (route === '/admin/tickets' && width === 320) {
        const ticket = page.getByRole('button', { name: new RegExp(subject) });
        await expect(ticket).toBeVisible();
        await ticket.click();
        await expect(page.getByLabel('Сообщение', { exact: true })).toBeInViewport();
        expect(await page.locator('main').innerText()).not.toContain('\uFFFD');
      }
      if (route === '/admin/tickets' && width === 980)
        await page.screenshot({ path: 'test-results/admin-responsive.png' });
    }
  }
  expect(issues).toEqual([]);
  console.log('Verified 16 routes at 320, 393, 768, 980 and 1440px.');
});

test('Kinza has a neutral card and six working flavour photos', async ({ page }) => {
  const kinza = await (await page.request.get('/api/products/kinza')).json();
  expect(kinza.imageUrl).toBeNull();
  expect(kinza.variants.map((variant: { name: string }) => variant.name)).toEqual([
    'Кола',
    'Апельсин',
    'Цитрус',
    'Чёрная смородина',
    'Гранат',
    'Лимон',
  ]);
  await page.goto('/menu/kinza');
  await page.getByRole('button', { name: 'В корзину', exact: true }).click();
  const dialog = page.getByRole('dialog');
  for (const variant of kinza.variants) {
    await dialog.getByRole('button', { name: variant.name, exact: true }).click();
    const image = dialog.getByAltText(`Kinza — ${variant.name}`, { exact: true });
    await expect(image).toBeVisible();
    await expect
      .poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0))
      .toBe(true);
  }
  await page.screenshot({ path: 'test-results/kinza-six-flavours.png' });
  expect((await (await page.request.get('/api/products/cola-05')).json()).description).toBe('железная банка');
});

test('notifications remain usable in the mobile menu', async ({ page, baseURL }) => {
  await admin(page, baseURL);
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Меню', exact: true }).click();
  const bell = page.getByRole('button', { name: 'Уведомления', exact: true });
  await expect(bell).toBeVisible();
  await bell.click();
  const notifications = page.getByRole('dialog', { name: 'Уведомления', exact: true });
  await expect(notifications).toBeInViewport();
  const panel = await notifications.boundingBox();
  expect(panel!.x).toBeGreaterThanOrEqual(0);
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(320);
});
