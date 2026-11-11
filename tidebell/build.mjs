// Bundles src/main.js with three.js and inlines it, the GLB and its metadata into one self-contained index.html.
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';

const result = await build({
  entryPoints: ['src/main.js'], bundle: true, minify: !process.argv.includes('--dev'), format: 'iife', write: false, target: 'es2022',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const glb = readFileSync('assets/tidebell.glb').toString('base64');
const meta = readFileSync('assets/meta.json', 'utf8').replace(/</g, '\\u003c');
const html = readFileSync('src/index.template.html', 'utf8')
  .replace('/*META*/', () => meta)
  .replace('/*GLB*/', () => glb)
  .replace('/*BUNDLE*/', () => js);
writeFileSync('index.html', html);
console.log(`index.html written (${(html.length / 1048576).toFixed(2)} MiB)`);
