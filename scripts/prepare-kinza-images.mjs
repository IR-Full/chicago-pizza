import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { default: sharp } = await import(
  pathToFileURL(join(root, 'client/node_modules/sharp/dist/index.mjs')).href
);
const output = join(root, 'client/public/menu');
mkdirSync(output, { recursive: true });
const photos = {
  cola: 'kinza_cola_blue.webp',
  orange: 'kinza_orange.webp',
  pomegranate: 'kinza_pomegranate-red.webp',
  lemon: 'kinza_lemon_dark-green.webp',
  citrus: 'kinza_citrus_light-green.webp',
  blackcurrant: 'kinza_blackcurrant.webp',
};
for (const [slug, file] of Object.entries(photos)) {
  for (const width of [160, 340, 768]) {
    await sharp(join(root, 'asserts/kinza', file))
      .resize(width, width, { fit: 'contain', background: '#ffffff' })
      .webp({ quality: 85 })
      .toFile(join(output, `kinza-${slug}-${width}.webp`));
  }
}
console.log('Prepared 18 Kinza images (six flavour photographs).');
