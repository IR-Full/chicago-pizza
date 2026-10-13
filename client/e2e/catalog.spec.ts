import { expect, test } from '@playwright/test';
import type { PizzaConfig, Product } from '../src/shared/api/types';

test('every catalogue configuration is priced and all product cards are reachable', async ({ page }) => {
  test.setTimeout(240_000);
  const response = await page.request.get('/api/products?limit=100');
  expect(response.ok()).toBe(true);
  const catalogue = (await response.json()) as { items: Product[]; total: number };
  expect(catalogue.items.length).toBe(catalogue.total);
  const doughs = await (await page.request.get('/api/dough-types')).json();
  let configurations = 0;
  for (const product of catalogue.items) {
    const configs: PizzaConfig[] =
      product.type === 'PIZZA'
        ? product.sizes.map((size) => ({
            productId: product.id,
            sizeCm: size.sizeCm,
            doughTypeId: doughs[0].id,
          }))
        : product.variants.length
          ? product.variants.map((variant) => ({ productId: product.id, variantId: variant.id }))
          : [{ productId: product.id }];
    expect(configs.length, `${product.name}: no purchasable configuration`).toBeGreaterThan(0);
    for (const config of configs) {
      const priced = await page.request.post('/api/products/price', { data: { config, quantity: 1 } });
      expect(priced.ok(), `${product.name}: ${await priced.text()}`).toBe(true);
      expect((await priced.json()).totalPrice).toBeGreaterThan(0);
      configurations++;
    }
    const detail = await page.goto(`/menu/${product.slug}`);
    expect(detail?.status(), product.slug).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: product.name, exact: true })).toBeVisible();
    if (product.imageUrl) {
      const image = page.getByAltText(product.name, { exact: true }).first();
      await expect(image).toBeVisible();
      await expect
        .poll(() =>
          image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0),
        )
        .toBe(true);
    }
  }
  for (let number = 1; number <= Math.ceil(catalogue.total / 24); number++) {
    const expectedPage = await (await page.request.get(`/api/products?limit=24&page=${number}`)).json();
    await page.goto(`/menu?page=${number}`);
    for (const product of expectedPage.items) {
      await expect(
        page.locator('article').getByRole('link', { name: product.name, exact: true }),
      ).toBeVisible();
    }
  }
  console.log(`Verified ${catalogue.total} product pages/cards and ${configurations} price configurations.`);
});

test('every product and all six Kinza flavours can be added through the UI', async ({ page }) => {
  test.setTimeout(240_000);
  const catalogue = (await (await page.request.get('/api/products?limit=100')).json()) as {
    items: Product[];
  };
  let added = 0;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const product of catalogue.items) {
    for (const variant of product.variants.length ? product.variants : [null]) {
      await page.goto(`/menu/${product.slug}`);
      await page
        .getByRole('button', { name: product.type === 'PIZZA' ? 'Собрать' : 'В корзину', exact: true })
        .click();
      const dialog = page.getByRole('dialog');
      if (variant) await dialog.getByRole('button', { name: variant.name, exact: true }).click();
      const button = dialog.getByRole('button', { name: /Добавить в корзину/i });
      await expect(button).toBeEnabled({ timeout: 15_000 });
      const bounds = await button.boundingBox();
      const viewport = page.viewportSize()!;
      expect(bounds!.x, `${product.name}: add button clipped on the left`).toBeGreaterThanOrEqual(0);
      expect(
        bounds!.x + bounds!.width,
        `${product.name}: add button clipped on the right`,
      ).toBeLessThanOrEqual(viewport.width);
      expect(
        await dialog.evaluate((element) => element.scrollWidth - element.clientWidth),
        `${product.name}: dialog overflows horizontally`,
      ).toBeLessThanOrEqual(1);
      if (product.slug === 'kinza' && variant?.slug === 'lemon') {
        await expect(dialog.getByAltText('Kinza — Лимон')).toBeVisible();
        await page.screenshot({ path: `test-results/kinza-${test.info().project.name}.png` });
      }
      await button.click();
      await expect(dialog).toBeHidden();
      added++;
    }
  }
  await page.goto('/cart');
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('chicago-pizza:guest-cart') ?? '[]'),
  );
  // Read the preview response independently of local UI counts and check
  // that the server retained every product and the six distinct flavours.
  const preview = await page.request.post('/api/cart/preview', { data: { lines: stored } });
  expect(preview.ok(), await preview.text()).toBe(true);
  const cart = await preview.json();
  expect(cart.lines.length).toBe(added);
  expect(cart.removed).toEqual([]);
  const kinza = catalogue.items.find((product) => product.slug === 'kinza')!;
  expect(
    cart.lines
      .filter((line: { productName: string }) => line.productName === kinza.name)
      .map((line: { variantName: string }) => line.variantName)
      .sort(),
  ).toEqual(kinza.variants.map((variant) => variant.name).sort());
  expect(errors).toEqual([]);
  console.log(
    `Added ${added} configurations through the UI, including ${kinza.variants.length} Kinza flavours.`,
  );
});
