#!/usr/bin/env node
/**
 * Turns the photographer's originals in `asserts/pizza/` into the web-sized
 * variants the site actually serves, in `client/public/menu/`.
 *
 * Run it when a photo is added or replaced:
 *
 *   node scripts/prepare-menu-images.mjs
 *
 * **Its output is committed.** Source material is tracked under `asserts/`,
 * but a build must not depend on it: the Docker image only copies `client/`.
 *
 * Why resize at all: the originals are 1000×1000, ~110 KB each, and the menu
 * grid draws them at 170 CSS px. Twenty of those is 2.4 MB to render a page
 * of thumbnails. The three widths below cover every place a product picture
 * appears, so the browser can pick the smallest one that still looks sharp:
 *
 *   160  cart line thumbnail (80 px, ×2)
 *   340  catalog card        (170 px, ×2)
 *   768  product detail page (384 px, ×2)
 *
 * The site keeps plain `<img srcset>` rather than `next/image`: the Next
 * optimizer is switched off on purpose (see `images.unoptimized` in
 * `next.config.mjs`), and pre-sized files need no optimizer at all.
 *
 * Alpha is preserved — the pizzas are cut out against transparency, which is
 * what lets them sit on the card's coloured plate without a visible box.
 */

import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = join(ROOT, 'asserts', 'pizza');
const OUTPUT_DIR = join(ROOT, 'client', 'public', 'menu');

/** Widths to emit, and the `-NNN.webp` suffix each one is stored under. */
const WIDTHS = [160, 340, 768];

/**
 * Photo file (without extension) → product slug in the catalogue.
 *
 * Explicit rather than derived, because the two genuinely disagree: the
 * photos are named after the pizza in transliteration and the slugs are what
 * the URL has to read as. `pizza_bbq` is the product `bbq`,
 * `pizza_pepperoni` is `pepperoni-pizza`, `pizza_chorizo` is `chorizo-pizza`
 * (plain `chorizo` is the sausage, an ingredient). A missing or
 * unknown entry is a hard error — a silently unillustrated menu item is
 * exactly the bug this mapping exists to prevent.
 */
const SLUG_BY_PHOTO = {
  pizza_4cheese: '4-cheese',
  pizza_5cheese: '5-cheese',
  pizza_assorti: 'assorti',
  pizza_bbq: 'bbq',
  pizza_caesar: 'caesar',
  pizza_chicken: 'chicken',
  pizza_chickenandmushrooms: 'chicken-mushrooms',
  pizza_chorizo: 'chorizo-pizza',
  pizza_home: 'home',
  pizza_hunter: 'hunter',
  pizza_julienne: 'julienne',
  pizza_margarita: 'margarita',
  pizza_meat: 'meat',
  pizza_mushroom: 'mushroom',
  pizza_oisi: 'oisi',
  pizza_pepperoni: 'pepperoni-pizza',
  pizza_sicily: 'sicily',
  pizza_spicy: 'spicy',
  pizza_tomyam: 'tom-yam',
  pizza_tropic: 'tropic',
};

async function main() {
  if (!existsSync(SOURCE_DIR)) {
    console.error(
      `No source photos at ${SOURCE_DIR}.\n` +
        'This script regenerates committed files; if you are only building the ' +
        'site, you do not need to run it.',
    );
    process.exit(1);
  }

  // Resolved from the client workspace: sharp is Next's own dependency and is
  // not a direct dependency of the repo root. `pathToFileURL` because a
  // Windows absolute path ("C:\...") is not a URL the ESM loader accepts.
  const { default: sharp } = await import(
    pathToFileURL(join(ROOT, 'client', 'node_modules', 'sharp', 'dist', 'index.mjs')).href
  );

  mkdirSync(OUTPUT_DIR, { recursive: true });

  const photos = readdirSync(SOURCE_DIR).filter((f) => f.endsWith('.webp'));
  if (!photos.length) {
    console.error(`No .webp files in ${SOURCE_DIR}`);
    process.exit(1);
  }

  const unknown = photos.map((f) => basename(f, '.webp')).filter((n) => !(n in SLUG_BY_PHOTO));
  if (unknown.length) {
    console.error(
      `These photos have no slug in SLUG_BY_PHOTO: ${unknown.join(', ')}.\n` +
        'Add them there (and to the seed) rather than letting them be skipped.',
    );
    process.exit(1);
  }

  let written = 0;
  let bytesIn = 0;
  let bytesOut = 0;

  for (const file of photos.sort()) {
    const slug = SLUG_BY_PHOTO[basename(file, '.webp')];
    const source = join(SOURCE_DIR, file);
    bytesIn += statSync(source).size;

    for (const width of WIDTHS) {
      const target = join(OUTPUT_DIR, `${slug}-${width}.webp`);
      await sharp(source)
        // `fit: 'inside'` keeps the square aspect without padding, and
        // `withoutEnlargement` means a smaller original is copied rather
        // than upscaled into false sharpness.
        .resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82, effort: 6, alphaQuality: 90 })
        .toFile(target);

      bytesOut += statSync(target).size;
      written += 1;
    }
  }

  const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;
  console.log(
    `${written} files from ${photos.length} photos → client/public/menu\n` +
      `originals ${mb(bytesIn)} → variants ${mb(bytesOut)}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
