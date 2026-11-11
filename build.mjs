// Bundles src/main.js (plus three.js from node_modules) into one self-contained, offline scene.html.
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';

const result = await build({
  entryPoints: ['src/main.js'], bundle: true, minify: true, format: 'iife', write: false, target: 'es2022',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>Qingyun Sect Gate at Dawn</title>
<style>
  html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
  canvas { display: block; width: 100vw; height: 100vh; object-fit: contain; }
</style>
</head>
<body>
<canvas id="c" width="1080" height="1920"></canvas>
<script>
${js}
</script>
</body>
</html>
`;
writeFileSync('scene.html', html);
console.log(`scene.html written (${(html.length / 1024).toFixed(0)} KiB)`);
