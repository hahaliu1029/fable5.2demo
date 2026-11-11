// Frame-rate measurement in headless Chrome (GPU-backed), with the autopilot flying a real run.
//   realtime: the normal requestAnimationFrame loop for 12 s (this is capped by the display refresh rate)
//   cost:     uncapped ms per frame = game step + all render passes + a forced GPU sync (gl.readPixels)
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL_BASE = pathToFileURL(path.join(ROOT, 'index.html')).href;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const rows = [];
try {
  for (const [label, w, h, dpr] of [['1440x900 @1x', 1440, 900, 1], ['1440x900 @2x (retina)', 1440, 900, 2], ['390x844 @3x (phone)', 390, 844, 3]]) {
    for (const q of ['high', 'low']) {
      const page = await browser.newPage();
      await page.setViewport({ width: w, height: h, deviceScaleFactor: dpr });
      await page.goto(`${URL_BASE}?bot&q=${q}`);
      await page.waitForFunction('window.__ready === true');
      await page.click('#startBtn');
      await new Promise((r) => setTimeout(r, 2000)); // warm-up (shader compilation)
      await page.evaluate(() => { window.__game.perf.samples.length = 0; });
      await new Promise((r) => setTimeout(r, 12000));
      const rt = await page.evaluate(() => {
        const s = window.__game.perf.samples.slice().sort((a, b) => a - b), n = s.length, avg = s.reduce((a, b) => a + b, 0) / n;
        return { frames: n, fps: 1000 / avg, p95: s[Math.floor(n * 0.95)], worst: s[n - 1], ...window.__game.info() };
      });
      await page.close();
      const page2 = await browser.newPage();
      await page2.setViewport({ width: w, height: h, deviceScaleFactor: dpr });
      await page2.goto(`${URL_BASE}?capture&bot&q=${q}`);
      await page2.waitForFunction('window.__ready === true');
      await page2.click('#startBtn');
      const cost = await page2.evaluate(() => {
        const g = window.__game, gl = document.getElementById('c').getContext('webgl2'), px = new Uint8Array(4);
        for (let i = 0; i < 60; i++) g.step(1 / 60, true);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const t0 = performance.now(), N = 600;
        for (let i = 0; i < N; i++) { g.step(1 / 60, true); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
        return (performance.now() - t0) / N;
      });
      await page2.close();
      rows.push({ viewport: label, quality: q, render: `${rt.w}x${rt.h}`, 'realtime fps': rt.fps.toFixed(1), 'p95 ms': rt.p95.toFixed(1), 'worst ms': rt.worst.toFixed(1), 'uncapped ms/frame': cost.toFixed(2), 'uncapped fps': (1000 / cost).toFixed(0) });
      if (rows.length === 1) console.log('GPU:', rt.glRenderer);
    }
  }
  console.table(rows);
} finally { await browser.close(); }
