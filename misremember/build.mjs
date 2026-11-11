// Bundles src/main.js with three.js and inlines it, the Blender models, the lightmaps and the images into one
// self-contained index.html.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const result = await build({
  entryPoints: ['src/main.js'], bundle: true, minify: true, format: 'esm', write: false, target: 'es2022',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const b64 = (p) => readFileSync(p).toString('base64');
const img = {};
for (const f of readdirSync('assets/img').filter((x) => x.endsWith('.webp'))) img[f.replace('.webp', '')] = b64(`assets/img/${f}`);
for (const f of readdirSync('assets/lm').filter((x) => x.endsWith('.webp'))) img[`lm/${f.replace('.webp', '')}`] = b64(`assets/lm/${f}`);
const data = {
  house: b64('assets/house.glb'), props: b64('assets/props.glb'),
  meta: JSON.parse(readFileSync('assets/house_meta.json', 'utf8')), img,
};
const html = readFileSync('src/index.template.html', 'utf8')
  .replace('/*DATA*/', () => JSON.stringify(data).replace(/</g, '\\u003c')).replace('/*BUNDLE*/', () => js);
writeFileSync('index.html', html);
console.log(`index.html written (${(html.length / 1048576).toFixed(1)} MiB, ${Object.keys(img).length} images)`);
