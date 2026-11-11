// Converts the raw generated images and baked lightmaps into the WebP files the build inlines.
// Usage: node tools/images.mjs [--sheet]   (--sheet also writes a contact sheet for eyeballing the raw images)
import { readdir, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const raw = join(root, 'assets', 'img', 'raw');
const out = join(root, 'assets', 'img');
const lm = join(root, 'assets', 'lm');
const SMALL = /^(dinner_plate|family_photo|painting)/;

await mkdir(out, { recursive: true });
const files = (await readdir(raw)).filter((f) => f.endsWith('.png')).sort();
for (const f of files) {
  const name = f.replace(/\.png$/, '');
  const size = SMALL.test(name) ? 640 : 1024;
  await sharp(join(raw, f)).resize(size, size, { fit: 'inside' }).webp({ quality: 82 }).toFile(join(out, `${name}.webp`));
}
for (const f of (await readdir(lm)).filter((x) => x.endsWith('.png'))) {
  await sharp(join(lm, f)).webp({ quality: 92 }).toFile(join(lm, f.replace(/\.png$/, '.webp')));
}
console.log(`${files.length} images converted`);

if (process.argv.includes('--sheet')) {
  const cell = 320;
  const cols = 6;
  const tiles = await Promise.all(files.map(async (f, i) => ({
    input: await sharp(join(raw, f)).resize(cell, cell, { fit: 'contain', background: '#222' }).png().toBuffer(),
    left: (i % cols) * cell, top: Math.floor(i / cols) * cell,
  })));
  await sharp({ create: { width: cols * cell, height: Math.ceil(files.length / cols) * cell, channels: 3, background: '#222' } })
    .composite(tiles).png().toFile(join(root, 'tools', 'blender', 'preview', 'sheet.png'));
}
