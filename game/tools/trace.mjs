// Debug helper: prints the autopilot's progress every few seconds of game time (logic only, no rendering).
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 540, height: 960 });
await page.goto(pathToFileURL(path.join(ROOT, 'index.html')).href + '?capture&bot&ss=0.5');
await page.waitForFunction('window.__ready === true');
await page.click('#startBtn');
const every = parseFloat(process.argv[2] || '5'), max = parseFloat(process.argv[3] || '300');
for (let t = 0; t < max; t += every) {
  const s = await page.evaluate((n) => { const g = window.__game; for (let i = 0; i < n; i++) g.step(1 / 30, false); const G = g.G, b = G.bot;
    return { mode: G.mode, time: +G.time.toFixed(1), count: G.count, hits: G.hits, bumps: G.bumps, pos: G.pos.toArray().map((v) => +v.toFixed(1)), fwd: +G.fwd.toFixed(1), yaw: +G.yaw.toFixed(2), target: b.target ? [b.target.i, b.target.x, b.target.y, b.target.z] : b.gate }; }, Math.round(every * 30));
  console.log(JSON.stringify(s));
  if (s.mode === 'done') break;
}
await browser.close();
