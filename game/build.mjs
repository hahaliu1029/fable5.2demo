// Bundles src/main.js (+ three.js) and the page shell into one self-contained, offline index.html.
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
const result = await build({ entryPoints: ['src/main.js'], bundle: true, minify: true, format: 'iife', write: false, target: 'es2022' });
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
// the Blender-built models travel inside the page too, so index.html stays a single offline file
const glb = readFileSync('assets/qingyun.glb').toString('base64');
const meta = readFileSync('assets/meta.json', 'utf8').replace(/</g, '\\u003c');
const html = readFileSync('src/index.template.html', 'utf8')
  .replace('/*__META__*/', () => meta).replace('/*__GLB__*/', () => glb).replace('/*__BUNDLE__*/', () => js);
writeFileSync('index.html', html);
console.log(`index.html written (${(html.length / 1024).toFixed(0)} KiB)`);
