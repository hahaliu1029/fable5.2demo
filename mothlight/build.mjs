// Bundles src/main.js with three.js and inlines it into one self-contained index.html.
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';

const result = await build({
  entryPoints: ['src/main.js'], bundle: true, minify: true, format: 'iife', write: false, target: 'es2022',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
// the Blender-built models ride inside the page, so index.html stays one offline file
const glb = readFileSync('assets/mothlight.glb').toString('base64');
const meta = readFileSync('assets/meta.json', 'utf8').replace(/</g, '\\u003c');
const html = readFileSync('src/index.template.html', 'utf8')
  .replace('/*META*/', () => meta).replace('/*GLB*/', () => glb).replace('/*BUNDLE*/', () => js);
writeFileSync('index.html', html);
console.log(`index.html written (${(html.length / 1024).toFixed(0)} KiB)`);
